/**
 * Slate — Gmail relay
 *
 * Runs inside your own Google account and forwards recently sent mail to the
 * Slate gmail-ingest Edge Function, which extracts any commitments you made
 * and queues them for review in the app.
 *
 * Setup
 * -----
 *  1. script.google.com → New project → paste this file in.
 *  2. Fill in INGEST_URL and INGEST_TOKEN below. Both are shown in Slate
 *     under ··· → Settings, once you enable the Gmail integration.
 *  3. Run setUp() once. Google will ask you to authorise Gmail access —
 *     this is your own script reading your own mail, so there is no consent
 *     screen to verify and no OAuth app to publish.
 *  4. That's it. It runs every 30 minutes.
 *
 * Run scanSentMail() by hand any time to force a scan. Nothing is sent
 * anywhere while the toggle in Slate is off — the Edge Function checks it
 * before doing any work.
 */

const INGEST_URL = 'PASTE_YOUR_INGEST_URL_HERE';
const INGEST_TOKEN = 'PASTE_YOUR_INGEST_TOKEN_HERE';

/** How far back to look. The server dedupes, so overlap is harmless. */
const LOOKBACK_DAYS = 2;

/**
 * Cap per run, to keep well inside the Apps Script execution time limit.
 * One message per thread, so this is effectively a thread cap.
 */
const MAX_MESSAGES = 25;

/** Quoted replies and signatures add cost without adding signal. */
const MAX_BODY_CHARS = 6000;

/**
 * Install the recurring trigger. Run once, by hand.
 */
function setUp() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'scanSentMail'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('scanSentMail').timeBased().everyMinutes(30).create();
  Logger.log('Trigger installed. Running a first scan now…');
  scanSentMail();
}

/**
 * Remove the trigger and forget the watermark.
 */
function tearDown() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'scanSentMail'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  PropertiesService.getScriptProperties().deleteProperty('lastSentEpoch');
  Logger.log('Trigger removed.');
}

/**
 * Cut the quoted thread off the bottom of a reply, leaving just your text.
 * Returns '' if that leaves nothing — the caller falls back to the raw body
 * rather than silently skipping the message.
 */
function stripQuotedText(body) {
  var cut = body.length;

  // Gmail's attribution line wraps, so match across the newline.
  var markers = [
    /\n\s*On\s[\s\S]{0,300}?\bwrote:/,
    /\n\s*-{2,}\s*Original Message\s*-{2,}/i,
    /\n\s*-{2,}\s*Forwarded message\s*-{2,}/i,
    /\n\s*_{10,}/
  ];

  for (var i = 0; i < markers.length; i++) {
    var at = body.search(markers[i]);
    if (at !== -1 && at < cut) cut = at;
  }

  return body
    .slice(0, cut)
    .split('\n')
    .filter(function (line) { return !/^\s*>/.test(line); })
    .join('\n')
    .trim();
}

function scanSentMail() {
  if (INGEST_URL.indexOf('PASTE_') === 0 || INGEST_TOKEN.indexOf('PASTE_') === 0) {
    throw new Error('Set INGEST_URL and INGEST_TOKEN first — both are in Slate under ··· → Settings.');
  }

  const props = PropertiesService.getScriptProperties();
  const watermark = Number(props.getProperty('lastSentEpoch') || 0);
  const me = Session.getActiveUser().getEmail().toLowerCase();

  const threads = GmailApp.search('in:sent newer_than:' + LOOKBACK_DAYS + 'd');
  const messages = [];
  let newestSeen = watermark;

  for (var t = 0; t < threads.length && messages.length < MAX_MESSAGES; t++) {
    const thread = threads[t];
    const threadMessages = thread.getMessages();

    // Only the last thing you said in this thread. Earlier messages in it
    // either went out in a previous scan, or have been superseded by this
    // one — and an "in:sent" thread also holds the replies you received.
    var msg = null;
    for (var m = threadMessages.length - 1; m >= 0; m--) {
      if (threadMessages[m].getFrom().toLowerCase().indexOf(me) !== -1) {
        msg = threadMessages[m];
        break;
      }
    }
    if (!msg) continue;

    const sentAt = msg.getDate().getTime();
    if (sentAt <= watermark) continue;

    const raw = (msg.getPlainBody() || '').trim();
    // Send only what you wrote, not the thread you wrote it above.
    const body = stripQuotedText(raw) || raw;
    if (!body) continue;

    messages.push({
      id: msg.getId(),
      subject: msg.getSubject() || '',
      to: msg.getTo() || '',
      date: msg.getDate().toISOString(),
      body: body.slice(0, MAX_BODY_CHARS),
      snippet: body.slice(0, 200).replace(/\s+/g, ' '),
      permalink: 'https://mail.google.com/mail/u/0/#all/' + msg.getId()
    });

    if (sentAt > newestSeen) newestSeen = sentAt;
  }

  if (!messages.length) {
    Logger.log('Nothing new to send.');
    return;
  }

  const response = UrlFetchApp.fetch(INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ token: INGEST_TOKEN, messages: messages }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) {
    // Leave the watermark alone so the next run retries these.
    Logger.log('Ingest failed (HTTP ' + code + '): ' + text);
    return;
  }

  const result = JSON.parse(text);

  if (result.disabled) {
    // The integration is switched off in Slate. Don't advance the watermark,
    // so whatever was sent while it was off gets picked up when it's on again.
    Logger.log('Gmail integration is switched off in Slate. Nothing processed.');
    return;
  }

  // Only advance past messages the server actually took responsibility for.
  // If some failed mid-batch, retry the whole window next run — the server
  // dedupes on message ID, so the successful ones cost nothing second time.
  if (result.failures && result.failures.length) {
    Logger.log('Sent ' + messages.length + ', ' + result.failures.length +
               ' failed — leaving watermark for retry: ' + JSON.stringify(result.failures));
    return;
  }

  props.setProperty('lastSentEpoch', String(newestSeen));
  Logger.log('Sent ' + messages.length + ' message(s); ' +
             result.suggested + ' suggestion(s) created.');
}
