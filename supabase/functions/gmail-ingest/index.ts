// gmail-ingest
//
// Receives a batch of sent Gmail messages from the Apps Script relay
// (integrations/gmail-relay.gs), asks Claude which of them contain a
// commitment the user made to someone, and writes the results to
// task_suggestions for review in the app.
//
// Deploy:  supabase functions deploy gmail-ingest --no-verify-jwt
//   (--no-verify-jwt because the Apps Script authenticates with the
//   per-user ingest_token, not a Supabase JWT.)
//
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import Anthropic from "npm:@anthropic-ai/sdk@0.115.0";
import { createClient } from "npm:@supabase/supabase-js@2.93.3";

const MODEL = "claude-opus-5";

// Bound the cost of a single pathological email (long quoted threads).
const MAX_BODY_CHARS = 6000;

// Messages per request. The relay sends at most this many; anything beyond
// waits for the next scan.
const MAX_BATCH = 25;

const SYSTEM_PROMPT = `You extract commitments from email that a person has sent.

You are given a single email written BY the user. Your job is to find every
promise the user made to do something, so it can become a task on their board.

## What counts as a commitment

A commitment is something the user said THEY would do, that is not yet done,
and that a reasonable person would expect them to follow through on. Typically
it has an actor (the user), an action, and someone it benefits.

Extract:
- "I'll send you the invoice tomorrow"
- "I'll take a look at the designs and get back to you"
- "Leave it with me, I'll chase the supplier"
- "Happy to write that up for you — will have it over by Friday"
- "I'm going to fix the checkout bug before the weekend"

## What does NOT count

Do not extract:
- Anything the OTHER person is doing. "Could you send me the file?" and
  "Sarah will handle the deploy" are not the user's commitments.
- Work already finished. "I've sent the invoice", "Fixed and deployed" —
  past tense means there is nothing left to do.
- Conditionals that were never accepted. "I could take a look if that helps"
  is an offer, not a promise.
- Social pleasantries. "Let me know if you need anything", "Happy to help",
  "Looking forward to it", "Speak soon" — these commit to nothing specific.
- Scheduled events. "See you Tuesday at 3" is a calendar entry, not a task.
  But "I'll send an agenda before Tuesday" IS a commitment.
- Automated or templated mail: newsletters, receipts, out-of-office replies,
  calendar invitations, notification mail the user's tools sent on their
  behalf. If it does not read as the user personally writing to a human,
  extract nothing.

## Dates

Resolve relative dates against the email's send date, given below. "Tomorrow",
"end of the week", "next Tuesday", "in a couple of days" all become concrete
calendar dates. Use ISO format (YYYY-MM-DD). Weeks start Monday; "end of the
week" means that Friday. If no deadline is stated or implied, return null —
do not invent one.

## Writing the task

- title: a short imperative phrase, as the user would write it on their own
  board. "Send Marcus the Q3 invoice", not "User will send invoice". No
  trailing punctuation. Aim for under 60 characters.
- description: one or two sentences of context, including the quoted phrase
  the commitment came from so the user can judge it at a glance. Empty string
  if the title already says everything.
- recipient: who the commitment is to, by name if the email gives you one,
  otherwise their email address. Empty string if genuinely unclear.
- confidence: how sure you are this is a real, outstanding commitment.
  Above 0.8 means the user plainly stated they would do a specific thing.
  Around 0.5 means it reads like a commitment but the wording is loose.
  Below 0.3 means you are mostly guessing — prefer to omit it entirely.

## Calibration

Most emails contain no commitment at all. Returning an empty array is the
correct and common answer, and is much better than stretching a pleasantry
into a task. A false task costs the user more than a missed one: they have to
notice it, read it, and delete it. When a phrase is ambiguous, leave it out.`;

const OUTPUT_SCHEMA = {
	type: "object",
	properties: {
		commitments: {
			type: "array",
			items: {
				type: "object",
				properties: {
					title: { type: "string" },
					description: { type: "string" },
					recipient: { type: "string" },
					due_date: {
						anyOf: [{ type: "string", format: "date" }, { type: "null" }],
					},
					confidence: { type: "number" },
				},
				required: ["title", "description", "recipient", "due_date", "confidence"],
				additionalProperties: false,
			},
		},
	},
	required: ["commitments"],
	additionalProperties: false,
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const supabase = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Ask Claude for the commitments in one email. Throws on API failure. */
async function extractCommitments(message: GmailMessage) {
	const response = await anthropic.messages.create({
		model: MODEL,
		max_tokens: 4000,
		output_config: {
			effort: "low",
			format: { type: "json_schema", schema: OUTPUT_SCHEMA },
		},
		system: [
			{
				type: "text",
				text: SYSTEM_PROMPT,
				// Stable across every message, so it caches. Volatile per-email
				// content goes in the user turn, after this breakpoint.
				cache_control: { type: "ephemeral" },
			},
		],
		messages: [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: [
							`Sent: ${message.date}`,
							`To: ${message.to || "(unknown)"}`,
							`Subject: ${message.subject || "(no subject)"}`,
							"",
							(message.body || "").slice(0, MAX_BODY_CHARS),
						].join("\n"),
					},
				],
			},
		],
	});

	// Safety classifiers can decline; content is empty or partial when they do.
	if (response.stop_reason === "refusal") {
		throw new Error("refused by safety classifier");
	}

	const text = response.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");

	const parsed = JSON.parse(text) as { commitments: Commitment[] };
	return parsed.commitments ?? [];
}

interface GmailMessage {
	id: string;
	subject?: string;
	to?: string;
	date: string;
	body?: string;
	snippet?: string;
	permalink?: string;
}

interface Commitment {
	title: string;
	description: string;
	recipient: string;
	due_date: string | null;
	confidence: number;
}

Deno.serve(async (req) => {
	if (req.method !== "POST") {
		return json({ error: "POST only" }, 405);
	}

	let payload: { token?: string; messages?: GmailMessage[] };
	try {
		payload = await req.json();
	} catch {
		return json({ error: "invalid JSON body" }, 400);
	}

	const token = payload.token?.trim();
	if (!token) return json({ error: "missing token" }, 401);

	const { data: settings } = await supabase
		.from("user_settings")
		.select("user_id, gmail_enabled, min_confidence")
		.eq("ingest_token", token)
		.maybeSingle();

	if (!settings) return json({ error: "unknown token" }, 401);

	// The toggle is enforced here, not just in the UI — turning it off in the
	// app stops ingest even if the Apps Script trigger keeps firing.
	if (!settings.gmail_enabled) {
		return json({ ok: true, disabled: true, processed: 0, suggested: 0 });
	}

	const incoming = (payload.messages ?? []).slice(0, MAX_BATCH);
	if (!incoming.length) {
		return json({ ok: true, processed: 0, suggested: 0 });
	}

	// Skip anything we've already looked at. This is the dedupe guard, and it
	// runs before the API call so a repeated scan costs nothing.
	const { data: seen } = await supabase
		.from("gmail_processed")
		.select("gmail_message_id")
		.eq("user_id", settings.user_id)
		.in("gmail_message_id", incoming.map((m) => m.id));

	const seenIds = new Set((seen ?? []).map((row) => row.gmail_message_id));
	const fresh = incoming.filter((m) => m.id && !seenIds.has(m.id));

	const suggestions: Record<string, unknown>[] = [];
	const processedIds: string[] = [];
	const failures: { id: string; error: string }[] = [];

	for (const message of fresh) {
		try {
			const commitments = await extractCommitments(message);

			for (const c of commitments) {
				if (typeof c.confidence === "number" && c.confidence < settings.min_confidence) {
					continue;
				}
				if (!c.title?.trim()) continue;

				suggestions.push({
					user_id: settings.user_id,
					gmail_message_id: message.id,
					title: c.title.trim(),
					description: c.description?.trim() || null,
					recipient: c.recipient?.trim() || null,
					due_date: c.due_date || null,
					confidence: c.confidence ?? null,
					email_subject: message.subject || null,
					email_snippet: message.snippet || null,
					email_date: message.date || null,
					email_link: message.permalink || null,
				});
			}

			processedIds.push(message.id);
		} catch (err) {
			// Leave it unprocessed so the next scan retries it.
			failures.push({ id: message.id, error: String(err) });
		}
	}

	if (suggestions.length) {
		const { error } = await supabase.from("task_suggestions").insert(suggestions);
		if (error) return json({ error: `insert failed: ${error.message}` }, 500);
	}

	if (processedIds.length) {
		await supabase.from("gmail_processed").upsert(
			processedIds.map((id) => ({ user_id: settings.user_id, gmail_message_id: id })),
			{ onConflict: "user_id,gmail_message_id" },
		);
	}

	return json({
		ok: true,
		received: incoming.length,
		skipped_already_seen: incoming.length - fresh.length,
		processed: processedIds.length,
		suggested: suggestions.length,
		failures,
	});
});
