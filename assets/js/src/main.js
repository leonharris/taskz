// sortableJS
import Sortable from 'sortablejs';
// Supabase
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Track current user
let currentUser = null;
let boardLoaded = false;
let boardDirty = false;
let lastSavedAt = null;
let boardChannel = null;
let activeFilter = 'all';
let archivedTasks = [];
let boardSortable = null;

function markDirty() {
  boardDirty = true;
  updateColumnCounts();
  scheduleMasonry();
}

function updateColumnCounts() {
  document.querySelectorAll('.status-column').forEach(col => {
    const count = col.querySelectorAll('.task').length;
    const badge = col.querySelector('.column-count');
    if (badge) badge.textContent = count;
  });
}

/*
* Supabase Authentication Functions
*/

// Sign up with email/password (disabled — UI removed, kept for future use)
// async function signUp(email, password) {
//   const { data, error } = await supabase.auth.signUp({
//     email,
//     password,
//   });
//   if (error) {
//     alert('Error signing up: ' + error.message);
//     return null;
//   }
//   alert('Check your email for the confirmation link!');
//   return data;
// }

// Sign in with email/password
async function signIn(email, password) {
	const { data, error } = await supabase.auth.signInWithPassword({
		email,
		password,
	});
	if (error) {
		console.error('Sign in error:', error);
		return { error };
	}
	return { data };
}

// Sign out
async function signOut() {
	// Clear UI immediately — don't wait for Supabase (signOut hangs sometimes)
	unsubscribeFromBoard();
	currentUser = null;
	if (boardSortable) {
		boardSortable.destroy();
		boardSortable = null;
	}
	updateAuthUI();
	document.getElementById('board').innerHTML = '';

	// Remove Supabase session from localStorage so a refresh won't restore it
	// (signOut() sometimes hangs and never actually clears the stored token)
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
			localStorage.removeItem(key);
		}
	}

	supabase.auth.signOut().catch(function () { });
}

// Update UI based on auth state
function updateAuthUI() {
	const authContainer = document.getElementById('auth-container');
	const appContent = document.getElementById('app-content');
	const userEmail = document.getElementById('user-email');

	if (currentUser) {
		authContainer.style.display = 'none';
		appContent.style.display = 'block';
		if (userEmail) userEmail.textContent = currentUser.email;
	} else {
		authContainer.style.display = 'flex';
		appContent.style.display = 'none';
	}
}

// Listen for auth state changes
supabase.auth.onAuthStateChange((event, session) => {
	currentUser = session?.user || null;
	updateAuthUI();

	// Don't await DB calls here — it deadlocks the Supabase client.
	if (currentUser && !boardLoaded) {
		boardLoaded = true;
		loadBoardFromSupabase(); // fire-and-forget (no await)
		loadGmailIntegration();  // same — awaiting here deadlocks the client
	} else if (!currentUser) {
		boardLoaded = false;
	}
});

// Check initial auth state
async function checkAuth() {
	const { data: { session } } = await supabase.auth.getSession();
	currentUser = session?.user || null;
	updateAuthUI();

	if (currentUser && !boardLoaded) {
		boardLoaded = true;
		await loadBoardFromSupabase();
		await loadGmailIntegration();
	}
}

/*
* Supabase Data Functions
*/

// Save board to Supabase. Returns true on success, false on failure.
async function saveBoardToSupabase() {
	if (!currentUser) return true;

	const boardData = getBoardData();
	if (!boardData.columns.length && !boardData.archived.length) return true;

	const now = new Date().toISOString();

	try {
		const { error } = await supabase
			.from('boards')
			.upsert(
				{ user_id: currentUser.id, data: boardData, updated_at: now },
				{ onConflict: 'user_id' }
			);

		if (error) {
			console.error('Error saving board:', error);
			return false;
		}
		lastSavedAt = now;
		return true;
	} catch (err) {
		console.error('saveBoardToSupabase threw:', err);
		return false;
	}
}

// Load board from Supabase
async function loadBoardFromSupabase() {
	if (!currentUser) return;

	try {
		const { data: board, error } = await supabase
			.from('boards')
			.select('data')
			.eq('user_id', currentUser.id)
			.single();

		if (error && error.code !== 'PGRST116') {
			console.error('Error loading board:', error);
			return;
		}

		if (board && board.data) {
			const rawData = board.data;
			let columns, archived;
			if (Array.isArray(rawData)) {
				// Old format: just an array of columns
				columns = rawData;
				archived = [];
			} else {
				columns = rawData.columns || [];
				archived = rawData.archived || [];
			}
			archivedTasks = purgeOldArchivedTasks(archived);
			// Clear existing board
			document.getElementById('board').innerHTML = '';
			// Populate from Supabase data
			populateTasksFromData(columns);
			subscribeToBoardChanges();
		} else {
			subscribeToBoardChanges();
			renderAddColumnButton();
		}
	} catch (err) {
		console.error('loadBoardFromSupabase threw:', err);
	}
}

// Auto-purge archived tasks older than 6 months
function purgeOldArchivedTasks(tasks) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  return tasks.filter(t => new Date(t.archivedAt) > cutoff);
}

// Get current board data as JSON
function getBoardData() {
	let boardData = [];
	const col = document.querySelectorAll('.status-column');

	for (let list of col) {
		let list_id = list.id;
		let col_el = document.getElementById(list_id);
		let col_header_text = col_el.querySelector('.status-column--header span[contenteditable]').textContent.trim();
		var col_color = getComputedStyle(col_el).getPropertyValue('--status-color');

		let tasks = list.querySelectorAll('.task');
		const task_data = [];
		let ii = 1;

		for (let task of tasks) {
			let task_title_el = task.getElementsByClassName('task--title');
			let task__title = task_title_el[0].textContent;
			let task__content = task.dataset.description || '';
			task_data.push({
				id: ii,
				task_title: task__title,
				task_content: task__content,
				priority: task.dataset.priority || 'none',
				due_date: task.dataset.dueDate || '',
				due_time: task.dataset.dueTime || ''
			});
			ii++;
		}

		boardData.push({
			name: col_header_text,
			color: col_color,
			span: getColSpan(col_el),
			tasks: task_data
		});
	}

	return { columns: boardData, archived: archivedTasks };
}

// Populate tasks from data (used by both localStorage and Supabase)
function populateTasksFromData(tasks) {
	let i = 0;
	for (let col of tasks) {
		let col_name = col.name;
		let col_color = col.color;
		let task_items = col.tasks;

		let blank_col = false;
		createList(blank_col, col_name, col_color, col.span);

		var listCol = document.getElementsByClassName('tasks-list');

		for (let task of task_items) {
			let task_li = createTask(task.task_title, task.task_content, task.priority, task.due_date, task.due_time);
			listCol[i].appendChild(task_li);
		}
		i++;
	}

	activateSortable();
	applyFilter(activeFilter);
	updateColumnCounts();
	renderAddColumnButton();
}

function applyFilter(filter) {
	activeFilter = filter;
	document.querySelectorAll('.task').forEach(task => {
		const matches = activeFilter === 'all' || task.dataset.priority === activeFilter;
		task.classList.toggle('is-filtered-out', !matches);
	});
	document.querySelectorAll('.filter-btn').forEach(btn => {
		btn.classList.toggle('is-active', btn.dataset.filter === activeFilter);
	});
}

// Filter button clicks (toggle — click active filter to clear)
document.addEventListener('click', (e) => {
	const btn = e.target.closest('.filter-btn');
	if (!btn) return;
	const filter = btn.dataset.filter;
	applyFilter(activeFilter === filter ? 'all' : filter);
});

/*
* Realtime Sync
* Subscribe to board changes from other devices/windows
*/

function subscribeToBoardChanges() {
  if (boardChannel || !currentUser) return;

  boardChannel = supabase
    .channel('board-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'boards',
        filter: `user_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const remoteUpdatedAt = payload.new.updated_at;
        // Ignore our own saves
        if (lastSavedAt && remoteUpdatedAt === lastSavedAt) return;

        if (boardDirty) {
          showSyncToast();
        } else {
          loadBoardFromSupabase();
        }
      }
    )
    .subscribe();
}

function unsubscribeFromBoard() {
  if (boardChannel) {
    supabase.removeChannel(boardChannel);
    boardChannel = null;
  }
  unsubscribeFromSuggestions();
}

function showSyncToast() {
  document.getElementById('sync-toast').style.display = 'flex';
}

function hideSyncToast() {
  document.getElementById('sync-toast').style.display = 'none';
}

// Sync toast button handlers
document.addEventListener('click', (e) => {
  if (e.target.id === 'sync-reload' || e.target.closest('#sync-reload')) {
    boardDirty = false;
    hideSyncToast();
    loadBoardFromSupabase();
  }
  if (e.target.id === 'sync-dismiss' || e.target.closest('#sync-dismiss')) {
    hideSyncToast();
  }
});

/*
// SortableJS
// Set initial sorting for Task lists on screen
*/
function activateSortable() {
	const taskListUL = document.querySelectorAll('.tasks-list');
	taskListUL.forEach((ul) => {
		new Sortable(ul, {
			animation: 300,
			delay: 200,
			delayOnTouchOnly: true,
			touchStartThreshold: 5,
			group: 'task-list',
			onSort: markDirty,
		});
	});
}

// Palette used to auto-assign column accent colours
const COLUMN_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981', '#3b82f6'];

function nextColumnColor() {
	const count = document.querySelectorAll('.status-column').length;
	return COLUMN_COLORS[count % COLUMN_COLORS.length];
}

// Add new List Column on form submit

function getStatusFormData(form) {
	const formData = new FormData(form);
	const columnTitle = formData.get('column_title');
	createList(true, columnTitle, nextColumnColor());
}

document.getElementById("form--add-list").addEventListener("submit", (event) => {
	event.preventDefault();
	getStatusFormData(event.target);
	closeModal();
	markDirty();
});


// Add task on "add task" button click
document.addEventListener('click', (e) => {
	const btn = e.target.closest('.btn-add-task');
	if (btn) {
		const column = btn.closest('.status-column');
		const taskListUL = column.querySelector('.tasks-list');
		const emptyTask = createTask("", "");
		emptyTask.dataset.isNew = 'true';
		taskListUL.appendChild(emptyTask);
		openTaskDetailModal(emptyTask);
	}
});



/*
* Create task
*/

function createTask(task_title, task_content, task_priority, due_date, due_time) {

	// create task data
	let title_content = task_title ? task_title : "Task title";
	let content_content = task_content ? task_content : "";
	let priority = task_priority || "none";

	// create task <li>
	let task_li = document.createElement("li");
	task_li.classList.add('task');
	task_li.dataset.priority = priority;

	// Top row: priority badge + delete button
	let task_top = document.createElement("div");
	task_top.classList.add('task--top');

	if (priority && priority !== "none") {
		task_top.innerHTML = `<div class="task--tags"><span class="task--tag task--tag-${priority}">${priority}</span></div>`;
	} else {
		task_top.innerHTML = '<div class="task--tags"></div>';
	}

	let btn_delete_task = document.createElement("div");
	btn_delete_task.classList.add('btn-delete-task-wrap');
	btn_delete_task.innerHTML = '<button class="btn-action btn-delete-task"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 512c141.4 0 256-114.6 256-256S397.4 0 256 0 0 114.6 0 256s114.6 256 256 256zm-72-280h144c13.3 0 24 10.7 24 24s-10.7 24-24 24H184c-13.3 0-24-10.7-24-24s10.7-24 24-24z"/></svg></button>';
	task_top.appendChild(btn_delete_task);
	task_li.appendChild(task_top);

	// create task title
	let task_header = document.createElement("h3");
	task_header.classList.add('task--title');
	let task_header_content = document.createTextNode(title_content);
	task_header.appendChild(task_header_content);
	task_li.appendChild(task_header);

	// create task content
	let task_content_div = document.createElement("div");
	task_content_div.classList.add('task--content');
	task_content_div.innerHTML = markdownToHtml(content_content);
	task_li.appendChild(task_content_div);

	// store raw (markdown) description text — task--content now holds rendered HTML
	task_li.dataset.description = content_content;

	// due date/time
	task_li.dataset.dueDate = due_date || '';
	task_li.dataset.dueTime = due_time || '';
	renderDueDate(task_li, due_date, due_time);

	observeTask(task_li);

	// return the <li class="task">
	return task_li;

}

// Format a due date (+ optional time) for display, e.g. "Jan 1, 2026" or "Jan 1, 2026, 3:00 PM"
function formatDueDate(due_date, due_time) {
	if (!due_date) return '';
	const [y, m, d] = due_date.split('-').map(Number);
	let text = new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	if (due_time) {
		const [hh, mm] = due_time.split(':').map(Number);
		text += ', ' + new Date(y, m - 1, d, hh, mm).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	}
	return text;
}

// Whether a due date (+ optional time) is in the past
function isDueOverdue(due_date, due_time) {
	if (!due_date) return false;
	const [y, m, d] = due_date.split('-').map(Number);
	let due;
	if (due_time) {
		const [hh, mm] = due_time.split(':').map(Number);
		due = new Date(y, m - 1, d, hh, mm);
	} else {
		due = new Date(y, m - 1, d, 23, 59, 59);
	}
	return due.getTime() < Date.now();
}

// Add/update/remove the due-date badge on a task card
function renderDueDate(task_li, due_date, due_time) {
	let due_el = task_li.querySelector('.task--due');
	if (!due_date) {
		if (due_el) due_el.remove();
		return;
	}
	if (!due_el) {
		due_el = document.createElement('div');
		due_el.classList.add('task--due');
		due_el.innerHTML = '<svg class="task--due-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 120c0-13.3 10.7-24 24-24s24 10.7 24 24V256c0 8.5-4.5 16.3-11.8 20.6l-96 56c-11.4 6.6-26.1 2.8-32.8-8.6s-2.8-26.1 8.6-32.8L232 243.4V120z"/></svg><span class="task--due-text"></span>';
		task_li.appendChild(due_el);
	}
	due_el.dataset.state = isDueOverdue(due_date, due_time) ? 'overdue' : 'upcoming';
	due_el.querySelector('.task--due-text').textContent = formatDueDate(due_date, due_time);
}



// Add Column
// Adds new list column

function nextColumnId() {
	let max = 0;
	document.querySelectorAll('.status-column').forEach(col => {
		const n = parseInt(col.id.replace('status_', ''), 10);
		if (!isNaN(n) && n > max) max = n;
	});
	return 'status_' + (max + 1);
}

function createList(blank_col, column_title, column_color, column_span) {

	const board = document.getElementById("board");
	const span = Math.min(Math.max(parseInt(column_span, 10) || 1, 1), MAX_COL_SPAN);

	// create task div
	let column = document.createElement("div");
	column.setAttribute("id", nextColumnId());
	column.classList.add('status-column');
	column.style.setProperty('--status-color', column_color);
	column.style.setProperty('--col-span', span);
	if (span > 1) column.classList.add('status-column--wide');
	let column_inner = document.createElement("div");
	column_inner.classList.add('status-column--wrap');
	column.appendChild(column_inner);

	let column_header = document.createElement("header");
	column_header.classList.add('status-column--header');

	let header_handle = document.createElement("span");
	header_handle.classList.add('handle');
	column_header.appendChild(header_handle);

	// Colored dot indicator
	let header_dot = document.createElement("span");
	header_dot.classList.add('status-dot');
	header_dot.style.backgroundColor = column_color;
	column_header.appendChild(header_dot);

	let header_text = document.createElement("span");
	const title_text = document.createTextNode(column_title);
	header_text.appendChild(title_text);
	header_text.contentEditable = "true";
	header_text.addEventListener('input', markDirty);
	column_header.appendChild(header_text);

	let count_badge = document.createElement("span");
	count_badge.classList.add('column-count');
	count_badge.textContent = '0';
	column_header.appendChild(count_badge);

	let btn_col_span = document.createElement("button");
	btn_col_span.classList.add('btn-col-span');
	updateColSpanButton(btn_col_span, span);
	column_header.appendChild(btn_col_span);

	let btn_delete_col = document.createElement("button");
	btn_delete_col.classList.add('btn-delete-col');
	btn_delete_col.setAttribute('aria-label', 'Delete column');
	btn_delete_col.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg>';
	column_header.appendChild(btn_delete_col);

	// add the html into the list <header>
	column_inner.appendChild(column_header);

	// Add task button (between header and task list)
	let btn_add_task = document.createElement("div");
	btn_add_task.classList.add('btn-add-task-wrap');
	btn_add_task.innerHTML = '<button class="btn-add-task"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M432 256C432 264.8 424.8 272 416 272h-176V448c0 8.844-7.156 16.01-16 16.01S208 456.8 208 448V272H32c-8.844 0-16-7.15-16-15.99C16 247.2 23.16 240 32 240h176V64c0-8.844 7.156-15.99 16-15.99S240 55.16 240 64v176H416C424.8 240 432 247.2 432 256z"/></svg> Add task</button>';
	column_inner.appendChild(btn_add_task);

	const task_list = document.createElement("ul");
	task_list.classList.add('tasks-list');
	column_inner.appendChild(task_list);

	// Add blank task into list,
	// not if calling from local Storage
	if (blank_col == true) {
		let empty_task = createTask("", "");
		task_list.appendChild(empty_task);
	}

	const inlineBtn = document.getElementById('add-list-inline');
	if (inlineBtn) {
	  board.insertBefore(column, inlineBtn);
	} else {
	  board.appendChild(column);
	}

	// SortableJS — column reordering (only one instance per board)
	if (!boardSortable) {
		boardSortable = new Sortable(board, {
			animation: 300,
			delay: 200,
			delayOnTouchOnly: true,
			touchStartThreshold: 5,
			handle: '.handle',
			draggable: '.status-column',
			onSort: markDirty,
		});
	}

	// clear input fields after adding a new list
	//todoInput.value = "";

	//deleteList();

}


// Render the inline "New category" button at the end of the board
function renderAddColumnButton() {
  const existing = document.getElementById('add-list-inline');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.id = 'add-list-inline';
  wrap.classList.add('add-list-inline');
  wrap.innerHTML = '<button class="add-list-inline--btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M432 256C432 264.8 424.8 272 416 272h-176V448c0 8.844-7.156 16.01-16 16.01S208 456.8 208 448V272H32c-8.844 0-16-7.15-16-15.99C16 247.2 23.16 240 32 240h176V64c0-8.844 7.156-15.99 16-15.99S240 55.16 240 64v176H416C424.8 240 432 247.2 432 256z"/></svg> New category</button>';
  document.getElementById('board').appendChild(wrap);
}

/*
* Delete buttons
------------------------------------------- */


// Delete task (event delegation) — soft-delete into trash
document.getElementById('board').addEventListener('click', (e) => {
	const btn = e.target.closest('.btn-delete-task');
	if (!btn) return;
	const parentTask = btn.closest('.task');
	if (parentTask) {
		let confirmation = confirm("Are you sure you want to delete this task?");
		if (confirmation) {
			const col = parentTask.closest('.status-column');
			const colName = col ? col.querySelector('.status-column--header span[contenteditable]').textContent : '';
			archivedTasks.push({
				task_title: parentTask.querySelector('.task--title').textContent,
				task_content: parentTask.dataset.description || '',
				priority: parentTask.dataset.priority || 'none',
				due_date: parentTask.dataset.dueDate || '',
				due_time: parentTask.dataset.dueTime || '',
				column: colName,
				archivedAt: new Date().toISOString()
			});
			parentTask.remove();
			markDirty();
		}
	}
});


// Column width — how many task-columns wide a status column is (1 or 2)
const MAX_COL_SPAN = 2;

const ICON_EXPAND = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M32 64C14.3 64 0 78.3 0 96L0 416c0 17.7 14.3 32 32 32s32-14.3 32-32L64 96c0-17.7-14.3-32-32-32zm448 0c-17.7 0-32 14.3-32 32l0 320c0 17.7 14.3 32 32 32s32-14.3 32-32l0-320c0-17.7-14.3-32-32-32zM342.6 233.4l-64-64c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L242.7 224 173.3 224l9.4-9.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-64 64c-12.5 12.5-12.5 32.8 0 45.3l64 64c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-9.4-9.4 69.5 0-9.4 9.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l64-64c12.5-12.5 12.5-32.8 0-45.3z"/></svg>';
const ICON_COLLAPSE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M32 64C14.3 64 0 78.3 0 96L0 416c0 17.7 14.3 32 32 32s32-14.3 32-32L64 96c0-17.7-14.3-32-32-32zm448 0c-17.7 0-32 14.3-32 32l0 320c0 17.7 14.3 32 32 32s32-14.3 32-32l0-320c0-17.7-14.3-32-32-32zM169.4 278.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-64-64c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l9.4 9.4 69.5 0-9.4-9.4zM297.4 233.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l64-64c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-9.4 9.4-69.5 0 9.4 9.4z"/></svg>';

function getColSpan(col) {
	const raw = parseInt(col.style.getPropertyValue('--col-span'), 10);
	return raw >= 1 && raw <= MAX_COL_SPAN ? raw : 1;
}

function setColSpan(col, span) {
	const clamped = Math.min(Math.max(parseInt(span, 10) || 1, 1), MAX_COL_SPAN);
	col.style.setProperty('--col-span', clamped);
	col.classList.toggle('status-column--wide', clamped > 1);
	const btn = col.querySelector('.btn-col-span');
	if (btn) updateColSpanButton(btn, clamped);
	scheduleMasonry();
}


/*
* Masonry layout for wide columns
*
* Wide columns lay tasks out in a real masonry grid so a short card doesn't
* leave dead space under it. The list uses 1px grid rows; each card is given a
* row span equal to its rendered height (plus one gap), which lets cards pack
* upwards independently per column while staying in normal document flow —
* which is what keeps SortableJS drag-and-drop working.
*/

let masonryFrame = null;

const taskResizeObserver = typeof ResizeObserver !== 'undefined'
	? new ResizeObserver(() => scheduleMasonry())
	: null;

// Batch layout into one frame — markDirty() fires on every keystroke
function scheduleMasonry() {
	if (masonryFrame) return;
	masonryFrame = requestAnimationFrame(() => {
		masonryFrame = null;
		layoutMasonry();
	});
}

function layoutMasonry() {
	document.querySelectorAll('.status-column').forEach(col => {
		const list = col.querySelector('.tasks-list');
		if (!list) return;
		const tasks = list.querySelectorAll('.task');

		// Narrow columns (and mobile, where the grid collapses to one column)
		// use plain flow — clear any spans left over from being wide.
		if (!col.classList.contains('status-column--wide') || window.innerWidth < 600) {
			tasks.forEach(task => { task.style.gridRowEnd = ''; });
			return;
		}

		const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
		tasks.forEach(task => {
			const height = task.getBoundingClientRect().height;
			task.style.gridRowEnd = 'span ' + (Math.ceil(height) + Math.round(gap));
		});
	});
}

// Tasks resize when their text rewraps (column widened, description edited),
// which changes the span they need — observe each card rather than guessing.
function observeTask(task) {
	if (taskResizeObserver) taskResizeObserver.observe(task);
}

window.addEventListener('resize', scheduleMasonry);

function updateColSpanButton(btn, span) {
	const wide = span > 1;
	btn.innerHTML = wide ? ICON_COLLAPSE : ICON_EXPAND;
	btn.setAttribute('aria-label', wide ? 'Make column narrow' : 'Make column wide');
	btn.setAttribute('title', wide ? 'Narrow column' : 'Wide column');
}

// Toggle column width (event delegation)
document.getElementById('board').addEventListener('click', (e) => {
	const btn = e.target.closest('.btn-col-span');
	if (!btn) return;
	const col = btn.closest('.status-column');
	if (!col) return;
	setColSpan(col, getColSpan(col) === 1 ? MAX_COL_SPAN : 1);
	markDirty();
});


// Delete column (event delegation) — archives all tasks in it
document.getElementById('board').addEventListener('click', (e) => {
	const btn = e.target.closest('.btn-delete-col');
	if (!btn) return;
	const col = btn.closest('.status-column');
	if (!col) return;
	const colName = col.querySelector('.status-column--header span[contenteditable]').textContent.trim();
	const taskCount = col.querySelectorAll('.task').length;
	const msg = taskCount > 0
		? `Delete "${colName}" and send its ${taskCount} task${taskCount === 1 ? '' : 's'} to trash?`
		: `Delete the "${colName}" column?`;
	if (!confirm(msg)) return;
	col.querySelectorAll('.task').forEach(task => {
		archivedTasks.push({
			task_title: task.querySelector('.task--title').textContent,
			task_content: task.dataset.description || '',
			priority: task.dataset.priority || 'none',
			due_date: task.dataset.dueDate || '',
			due_time: task.dataset.dueTime || '',
			column: colName,
			archivedAt: new Date().toISOString()
		});
	});
	col.remove();
	markDirty();
});


// Modals

const addListModal = document.getElementById('modal--add-list');
const closeModalButton = document.querySelector('#close-modal');

// Event listeners
closeModalButton.addEventListener("click", closeModal);

// Open "add category" modal from inline board button (event delegation)
document.addEventListener('click', (e) => {
  if (e.target.closest('.add-list-inline--btn')) openModal();
});

// Open modal
function openModal() {
	addListModal.classList.add('is-visible');
	// Focus the input after the transition starts
	setTimeout(() => document.getElementById('column_title').focus(), 50);
}
// Close modal
function closeModal() {
	addListModal.classList.remove('is-visible');
	document.getElementById('column_title').value = '';
}
// Close modal on backdrop click
addListModal.addEventListener('click', (e) => {
	if (e.target === addListModal) {
		closeModal();
	}
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
	const isEditing = document.activeElement.tagName === 'INPUT' ||
		document.activeElement.tagName === 'TEXTAREA' ||
		document.activeElement.isContentEditable;

	// N — add task to first column
	if (e.key === 'n' && !isEditing && !e.metaKey && !e.ctrlKey && !e.altKey) {
		const firstCol = document.querySelector('.status-column');
		if (firstCol) {
			const taskList = firstCol.querySelector('.tasks-list');
			const emptyTask = createTask('', '');
			emptyTask.dataset.isNew = 'true';
			taskList.appendChild(emptyTask);
			updateColumnCounts();
			openTaskDetailModal(emptyTask);
		}
		return;
	}

	// Escape — close open modal
	if (e.key !== 'Escape') return;
	if (addListModal.classList.contains('is-visible')) closeModal();
	if (taskDetailModal.classList.contains('is-visible')) closeTaskDetailModal();
	if (trashModal.classList.contains('is-visible')) closeTrashModal();
	if (suggestionsModal.classList.contains('is-visible')) closeSuggestionsModal();
	if (settingsModal.classList.contains('is-visible')) closeSettingsModal();
});


/*
* Task Detail Modal
*/
const taskDetailModal = document.getElementById('modal--task-detail');
const taskDetailForm = document.getElementById('form--task-detail');
const taskDetailTitle = document.getElementById('task-detail-title');
const taskDetailStatus = document.getElementById('task-detail-status');
const taskDetailPriority = document.getElementById('task-detail-priority');
const taskDetailDueDate = document.getElementById('task-detail-due-date');
const taskDetailDueTime = document.getElementById('task-detail-due-time');
const taskDetailDescription = document.getElementById('task-detail-description');
const taskDetailEditorToolbar = document.getElementById('task-detail-editor-toolbar');
let activeTask = null; // the <li> currently being edited

// Status/priority are pill groups (radios styled as toggles) rather than <select>s
function getPillValue(group) {
	const checked = group.querySelector('input:checked');
	return checked ? checked.value : '';
}

function setPillValue(group, value) {
	const inputs = Array.from(group.querySelectorAll('input'));
	const match = inputs.find((input) => input.value === value) || inputs[0];
	if (match) match.checked = true;
}

// Auto-grow the description textarea as the user types
taskDetailDescription.addEventListener('input', () => {
	taskDetailDescription.style.height = 'auto';
	taskDetailDescription.style.height = taskDetailDescription.scrollHeight + 'px';
});

// Wrap the current selection in the description textarea with markdown syntax
function wrapSelection(textarea, prefix, suffix = prefix) {
	const { selectionStart: start, selectionEnd: end, value } = textarea;
	const selected = value.slice(start, end);
	textarea.value = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
	textarea.focus();
	textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
	textarea.dispatchEvent(new Event('input'));
}

// Prefix each line of the current selection (expanded to full lines) with markdown syntax
function prefixLines(textarea, makePrefix) {
	const { selectionStart: start, selectionEnd: end, value } = textarea;
	const lineStart = value.lastIndexOf('\n', start - 1) + 1;
	let lineEnd = value.indexOf('\n', end);
	if (lineEnd === -1) lineEnd = value.length;
	const block = value.slice(lineStart, lineEnd);
	const newBlock = block.split('\n').map((line, i) => makePrefix(i) + line).join('\n');
	textarea.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
	textarea.focus();
	textarea.setSelectionRange(lineStart, lineStart + newBlock.length);
	textarea.dispatchEvent(new Event('input'));
}

// Insert a markdown link, using the selection as link text (or a placeholder)
function insertMarkdownLink(textarea) {
	const { selectionStart: start, selectionEnd: end, value } = textarea;
	const linkText = value.slice(start, end) || 'link text';
	const insertion = `[${linkText}](url)`;
	textarea.value = value.slice(0, start) + insertion + value.slice(end);
	textarea.focus();
	const urlStart = start + linkText.length + 3; // past "[linkText]("
	textarea.setSelectionRange(urlStart, urlStart + 3); // select placeholder "url"
	textarea.dispatchEvent(new Event('input'));
}

taskDetailEditorToolbar.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-md]');
	if (!btn) return;
	switch (btn.dataset.md) {
		case 'bold': wrapSelection(taskDetailDescription, '**'); break;
		case 'italic': wrapSelection(taskDetailDescription, '_'); break;
		case 'strike': wrapSelection(taskDetailDescription, '~~'); break;
		case 'code': wrapSelection(taskDetailDescription, '`'); break;
		case 'quote': prefixLines(taskDetailDescription, () => '> '); break;
		case 'ul': prefixLines(taskDetailDescription, () => '- '); break;
		case 'ol': { let n = 1; prefixLines(taskDetailDescription, () => `${n++}. `); break; }
		case 'link': insertMarkdownLink(taskDetailDescription); break;
	}
});

// Open task detail modal on task click (event delegation)
document.getElementById('board').addEventListener('click', (e) => {
	const taskEl = e.target.closest('.task');
	if (!taskEl) return;
	// Don't open modal if clicking delete button
	if (e.target.closest('.btn-delete-task-wrap')) return;
	openTaskDetailModal(taskEl);
});

function openTaskDetailModal(taskEl) {
	activeTask = taskEl;

	// Populate fields from the task DOM
	taskDetailTitle.value = taskEl.querySelector('.task--title').textContent;
	taskDetailDescription.value = taskEl.dataset.description || '';
	taskDetailDescription.style.height = 'auto';
	taskDetailDescription.style.height = taskDetailDescription.scrollHeight + 'px';
	setPillValue(taskDetailPriority, taskEl.dataset.priority || 'none');
	taskDetailDueDate.value = taskEl.dataset.dueDate || '';
	taskDetailDueTime.value = taskEl.dataset.dueTime || '';

	// Populate status pills with current columns
	taskDetailStatus.innerHTML = '';
	const columns = document.querySelectorAll('.status-column');
	const currentColumn = taskEl.closest('.status-column');
	columns.forEach((col) => {
		const name = col.querySelector('.status-column--header span[contenteditable]').textContent;
		const pill = document.createElement('label');
		pill.classList.add('pill');

		const radio = document.createElement('input');
		radio.type = 'radio';
		radio.name = 'task_status';
		radio.value = col.id;
		radio.checked = col === currentColumn;

		const text = document.createElement('span');
		text.textContent = name;

		pill.append(radio, text);
		taskDetailStatus.appendChild(pill);
	});

	taskDetailModal.classList.add('is-visible');
}

function closeTaskDetailModal() {
	// Cancelling a brand-new task (via Escape/backdrop/close button, not save)
	// should discard it instead of leaving a blank "Task title" card behind.
	if (activeTask && activeTask.dataset.isNew) {
		activeTask.remove();
		updateColumnCounts();
	}
	taskDetailModal.classList.remove('is-visible');
	activeTask = null;
}

// Close button
document.querySelector('.modal--close-task').addEventListener('click', closeTaskDetailModal);

// Backdrop click
taskDetailModal.addEventListener('click', (e) => {
	if (e.target === taskDetailModal) closeTaskDetailModal();
});

// Save task on form submit
taskDetailForm.addEventListener('submit', (e) => {
	e.preventDefault();
	if (!activeTask) return;
	delete activeTask.dataset.isNew;

	// Update task title
	activeTask.querySelector('.task--title').textContent = taskDetailTitle.value;

	// Update task content
	activeTask.dataset.description = taskDetailDescription.value;
	activeTask.querySelector('.task--content').innerHTML = markdownToHtml(taskDetailDescription.value);

	// Update priority
	const newPriority = getPillValue(taskDetailPriority) || 'none';
	activeTask.dataset.priority = newPriority;
	let tagsDiv = activeTask.querySelector('.task--tags');
	if (!tagsDiv) {
		tagsDiv = document.createElement('div');
		tagsDiv.classList.add('task--tags');
		activeTask.querySelector('.task--top').prepend(tagsDiv);
	}
	tagsDiv.innerHTML = newPriority !== 'none'
		? `<span class="task--tag task--tag-${newPriority}">${newPriority}</span>`
		: '';

	// Update due date/time
	activeTask.dataset.dueDate = taskDetailDueDate.value || '';
	activeTask.dataset.dueTime = taskDetailDueTime.value || '';
	renderDueDate(activeTask, taskDetailDueDate.value, taskDetailDueTime.value);

	// Move task to new column if status changed
	const targetColumnId = getPillValue(taskDetailStatus);
	const currentColumn = activeTask.closest('.status-column');
	if (targetColumnId && currentColumn && currentColumn.id !== targetColumnId) {
		const targetList = document.getElementById(targetColumnId).querySelector('.tasks-list');
		targetList.appendChild(activeTask);
	}

	markDirty();
	closeTaskDetailModal();
});


/*
* Trash Modal
*/

const trashModal = document.getElementById('modal--trash');
const trashList = document.getElementById('trash-list');

function openTrashModal() {
  renderTrashList();
  trashModal.classList.add('is-visible');
}

function closeTrashModal() {
  trashModal.classList.remove('is-visible');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Apply inline markdown (bold/italic/strike/code/links) to an already-escaped line
function inlineMarkdown(text) {
	return text
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/~~([^~]+)~~/g, '<del>$1</del>')
		.replace(/(^|[^_a-zA-Z0-9])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// Render a small, safe subset of Markdown (bold/italic/strike/code/links/lists/quotes) as HTML for display
function markdownToHtml(text) {
	if (!text) return '';
	const lines = escapeHtml(text).split('\n');
	let html = '';
	let listType = null; // 'ul' | 'ol' | null

	function closeList() {
		if (listType) { html += `</${listType}>`; listType = null; }
	}

	lines.forEach(line => {
		const ulMatch = line.match(/^[-*]\s+(.*)$/);
		const olMatch = line.match(/^\d+\.\s+(.*)$/);
		const quoteMatch = line.match(/^&gt;\s?(.*)$/);

		if (ulMatch) {
			if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
			html += `<li>${inlineMarkdown(ulMatch[1])}</li>`;
		} else if (olMatch) {
			if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
			html += `<li>${inlineMarkdown(olMatch[1])}</li>`;
		} else if (quoteMatch) {
			closeList();
			html += `<blockquote>${inlineMarkdown(quoteMatch[1])}</blockquote>`;
		} else if (line.trim() === '') {
			closeList();
		} else {
			closeList();
			html += `<p>${inlineMarkdown(line)}</p>`;
		}
	});
	closeList();
	return html;
}

function renderTrashList() {
  if (!archivedTasks.length) {
    trashList.innerHTML = '<p class="trash-empty">Trash is empty.</p>';
    return;
  }
  trashList.innerHTML = '';
  archivedTasks.forEach((task, i) => {
    const date = new Date(task.archivedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const item = document.createElement('div');
    item.classList.add('trash-item');
    item.innerHTML = `
      <div class="trash-item--info">
        <strong class="trash-item--title">${escapeHtml(task.task_title)}</strong>
        <span class="trash-item--meta">${escapeHtml(task.column)} &middot; Deleted ${date}</span>
      </div>
      <div class="trash-item--actions">
        <button class="btn btn-secondary btn-small btn-restore-task" data-index="${i}">Restore</button>
        <button class="btn btn-danger btn-small btn-delete-forever" data-index="${i}">Delete forever</button>
      </div>
    `;
    trashList.appendChild(item);
  });
}

function restoreTask(index) {
  const task = archivedTasks[index];
  if (!task) return;

  // Find target column by name, fall back to first column
  let targetList = null;
  document.querySelectorAll('.status-column').forEach(col => {
    const name = col.querySelector('.status-column--header span[contenteditable]').textContent;
    if (name === task.column) targetList = col.querySelector('.tasks-list');
  });
  if (!targetList) {
    const firstCol = document.querySelector('.status-column');
    if (firstCol) targetList = firstCol.querySelector('.tasks-list');
  }

  if (targetList) {
    const taskEl = createTask(task.task_title, task.task_content, task.priority, task.due_date, task.due_time);
    targetList.appendChild(taskEl);
  }

  archivedTasks.splice(index, 1);
  markDirty();
  renderTrashList();
}

function deleteForever(index) {
  archivedTasks.splice(index, 1);
  markDirty();
  renderTrashList();
}

function emptyTrash() {
  if (!archivedTasks.length) return;
  if (confirm('Permanently delete all trashed tasks? This cannot be undone.')) {
    archivedTasks = [];
    markDirty();
    renderTrashList();
  }
}

document.getElementById('btn-trash').addEventListener('click', openTrashModal);
document.getElementById('close-trash-modal').addEventListener('click', closeTrashModal);
trashModal.addEventListener('click', (e) => {
  if (e.target === trashModal) closeTrashModal();
});
document.getElementById('btn-empty-trash').addEventListener('click', emptyTrash);

trashList.addEventListener('click', (e) => {
  const restoreBtn = e.target.closest('.btn-restore-task');
  if (restoreBtn) {
    restoreTask(parseInt(restoreBtn.dataset.index));
    return;
  }
  const deleteBtn = e.target.closest('.btn-delete-forever');
  if (deleteBtn) {
    deleteForever(parseInt(deleteBtn.dataset.index));
  }
});


/*
* Gmail suggestions & settings
*
* Suggestions live in their own table rather than in the board JSON: the board
* is rewritten wholesale from the DOM every autosave, so anything written into
* it server-side is clobbered within 5 seconds. Accepting a suggestion here
* creates the task client-side and lets the normal autosave carry it.
*/

let userSettings = null;
let pendingSuggestions = [];
let suggestionsChannel = null;

const DEFAULT_SETTINGS = {
	gmail_enabled: false,
	target_column: null,
	scan_window_days: 2,
	min_confidence: 0.4,
};

const suggestionsModal = document.getElementById('modal--suggestions');
const suggestionsList = document.getElementById('suggestions-list');
const suggestionsBtn = document.getElementById('btn-suggestions');
const suggestionsCount = document.getElementById('suggestions-count');
const settingsModal = document.getElementById('modal--settings');
const settingsForm = document.getElementById('form--settings');
const settingsStatus = document.getElementById('settings-status');
const settingsGmailEnabled = document.getElementById('settings-gmail-enabled');
const settingsGmailOptions = document.getElementById('settings-gmail-options');
const settingsTargetColumn = document.getElementById('settings-target-column');

async function loadGmailIntegration() {
	if (!currentUser) return;
	await loadSettings();
	await loadSuggestions();
	subscribeToSuggestions();
}

async function loadSettings() {
	try {
		const { data, error } = await supabase
			.from('user_settings')
			.select('*')
			.eq('user_id', currentUser.id)
			.maybeSingle();

		if (error) {
			console.error('Error loading settings:', error);
			return;
		}

		if (data) {
			userSettings = data;
			return;
		}

		// First run — create the row so the ingest token is generated.
		const { data: created, error: insertError } = await supabase
			.from('user_settings')
			.insert({ user_id: currentUser.id })
			.select()
			.single();

		if (insertError) {
			console.error('Error creating settings:', insertError);
			return;
		}
		userSettings = created;
	} catch (err) {
		console.error('loadSettings threw:', err);
	}
}

async function loadSuggestions() {
	if (!currentUser) return;
	try {
		const { data, error } = await supabase
			.from('task_suggestions')
			.select('*')
			.eq('user_id', currentUser.id)
			.eq('status', 'pending')
			.order('created_at', { ascending: false });

		if (error) {
			console.error('Error loading suggestions:', error);
			return;
		}
		pendingSuggestions = data || [];
		updateSuggestionsBadge();
	} catch (err) {
		console.error('loadSuggestions threw:', err);
	}
}

function subscribeToSuggestions() {
	if (suggestionsChannel || !currentUser) return;

	suggestionsChannel = supabase
		.channel('suggestion-changes')
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'task_suggestions',
				filter: `user_id=eq.${currentUser.id}`,
			},
			(payload) => {
				if (payload.new.status !== 'pending') return;
				if (pendingSuggestions.some((s) => s.id === payload.new.id)) return;
				pendingSuggestions.unshift(payload.new);
				updateSuggestionsBadge();
				if (suggestionsModal.classList.contains('is-visible')) renderSuggestionsList();
			}
		)
		.subscribe();
}

function unsubscribeFromSuggestions() {
	if (suggestionsChannel) {
		supabase.removeChannel(suggestionsChannel);
		suggestionsChannel = null;
	}
	pendingSuggestions = [];
	userSettings = null;
	updateSuggestionsBadge();
}

function updateSuggestionsBadge() {
	const count = pendingSuggestions.length;
	suggestionsBtn.style.display = count ? 'flex' : 'none';
	suggestionsCount.textContent = count;
}

/*
* Suggestions modal
*/

function openSuggestionsModal() {
	renderSuggestionsList();
	suggestionsModal.classList.add('is-visible');
}

function closeSuggestionsModal() {
	suggestionsModal.classList.remove('is-visible');
}

function renderSuggestionsList() {
	if (!pendingSuggestions.length) {
		suggestionsList.innerHTML = '<p class="suggestions-empty">Nothing waiting. New commitments show up here after the next scan.</p>';
		return;
	}

	suggestionsList.innerHTML = '';
	pendingSuggestions.forEach((s) => {
		const item = document.createElement('div');
		item.classList.add('suggestion-item');
		item.dataset.id = s.id;

		const meta = [];
		if (s.recipient) meta.push('To ' + escapeHtml(s.recipient));
		if (s.due_date) meta.push('Due ' + escapeHtml(formatDueDate(s.due_date, '')));
		if (typeof s.confidence === 'number') meta.push(Math.round(s.confidence * 100) + '% sure');

		const source = s.email_subject
			? (s.email_link
				? `<a href="${escapeHtml(s.email_link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.email_subject)}</a>`
				: escapeHtml(s.email_subject))
			: '';

		item.innerHTML = `
			<div class="suggestion-item--info">
				<strong class="suggestion-item--title">${escapeHtml(s.title)}</strong>
				${s.description ? `<p class="suggestion-item--desc">${escapeHtml(s.description)}</p>` : ''}
				${meta.length ? `<span class="suggestion-item--meta">${meta.join(' &middot; ')}</span>` : ''}
				${source ? `<span class="suggestion-item--source">From: ${source}</span>` : ''}
			</div>
			<div class="suggestion-item--actions">
				<button class="btn btn-small btn-accept-suggestion" data-id="${escapeHtml(s.id)}">Add task</button>
				<button class="btn btn-secondary btn-small btn-dismiss-suggestion" data-id="${escapeHtml(s.id)}">Dismiss</button>
			</div>
		`;
		suggestionsList.appendChild(item);
	});
}

/** Find the column the user chose in settings, falling back to the first one. */
function resolveTargetList() {
	const columns = Array.from(document.querySelectorAll('.status-column'));
	if (!columns.length) return null;

	const preferred = userSettings && userSettings.target_column;
	if (preferred) {
		const match = columns.find((col) => {
			const name = col.querySelector('.status-column--header span[contenteditable]').textContent.trim();
			return name === preferred;
		});
		if (match) return match.querySelector('.tasks-list');
	}
	return columns[0].querySelector('.tasks-list');
}

async function acceptSuggestion(id) {
	const suggestion = pendingSuggestions.find((s) => s.id === id);
	if (!suggestion) return;

	const targetList = resolveTargetList();
	if (!targetList) {
		alert('Create a category first — there is nowhere to put the task yet.');
		return;
	}

	let description = suggestion.description || '';
	if (suggestion.email_link && suggestion.email_subject) {
		if (description) description += '\n\n';
		description += `[${suggestion.email_subject}](${suggestion.email_link})`;
	}

	const taskEl = createTask(suggestion.title, description, 'none', suggestion.due_date || '', '');
	targetList.appendChild(taskEl);
	updateColumnCounts();
	scheduleMasonry();
	markDirty();

	await setSuggestionStatus([id], 'accepted');
}

async function dismissSuggestion(id) {
	await setSuggestionStatus([id], 'dismissed');
}

async function dismissAllSuggestions() {
	if (!pendingSuggestions.length) return;
	if (!confirm(`Dismiss all ${pendingSuggestions.length} suggestions?`)) return;
	await setSuggestionStatus(pendingSuggestions.map((s) => s.id), 'dismissed');
}

/** Update rows remotely, then drop them from the local pending list. */
async function setSuggestionStatus(ids, status) {
	// Update the UI first — the task is already on the board, and a failed
	// status write only means the suggestion reappears on next load.
	pendingSuggestions = pendingSuggestions.filter((s) => !ids.includes(s.id));
	updateSuggestionsBadge();
	renderSuggestionsList();

	const { error } = await supabase
		.from('task_suggestions')
		.update({ status })
		.in('id', ids);

	if (error) console.error(`Error marking suggestion ${status}:`, error);
}

document.getElementById('btn-suggestions').addEventListener('click', openSuggestionsModal);
document.getElementById('close-suggestions-modal').addEventListener('click', closeSuggestionsModal);
suggestionsModal.addEventListener('click', (e) => {
	if (e.target === suggestionsModal) closeSuggestionsModal();
});
document.getElementById('btn-dismiss-all-suggestions').addEventListener('click', dismissAllSuggestions);

suggestionsList.addEventListener('click', (e) => {
	const accept = e.target.closest('.btn-accept-suggestion');
	if (accept) {
		acceptSuggestion(accept.dataset.id);
		return;
	}
	const dismiss = e.target.closest('.btn-dismiss-suggestion');
	if (dismiss) dismissSuggestion(dismiss.dataset.id);
});

/*
* Settings modal
*/

function openSettingsModal() {
	if (!userSettings) {
		alert('Settings are still loading — try again in a moment.');
		return;
	}

	settingsGmailEnabled.checked = !!userSettings.gmail_enabled;
	document.getElementById('settings-scan-window').value = userSettings.scan_window_days ?? DEFAULT_SETTINGS.scan_window_days;
	document.getElementById('settings-min-confidence').value = userSettings.min_confidence ?? DEFAULT_SETTINGS.min_confidence;
	document.getElementById('settings-ingest-url').value = `${supabaseUrl}/functions/v1/gmail-ingest`;

	const tokenField = document.getElementById('settings-ingest-token');
	tokenField.value = userSettings.ingest_token || '';
	tokenField.type = 'password';
	const revealBtn = document.querySelector('.btn-reveal');
	if (revealBtn) revealBtn.textContent = 'Show';

	// Column pills, from the board as it stands right now
	settingsTargetColumn.innerHTML = '';
	const columns = Array.from(document.querySelectorAll('.status-column'));
	if (!columns.length) {
		settingsTargetColumn.innerHTML = '<p class="form-field--hint">Create a category first.</p>';
	} else {
		columns.forEach((col, i) => {
			const name = col.querySelector('.status-column--header span[contenteditable]').textContent.trim();
			const pill = document.createElement('label');
			pill.classList.add('pill');

			const radio = document.createElement('input');
			radio.type = 'radio';
			radio.name = 'settings_target_column';
			radio.value = name;
			radio.checked = userSettings.target_column
				? userSettings.target_column === name
				: i === 0;

			const text = document.createElement('span');
			text.textContent = name;

			pill.append(radio, text);
			settingsTargetColumn.appendChild(pill);
		});
	}

	settingsStatus.textContent = '';
	settingsGmailOptions.hidden = !settingsGmailEnabled.checked;
	settingsModal.classList.add('is-visible');
}

function closeSettingsModal() {
	settingsModal.classList.remove('is-visible');
}

settingsGmailEnabled.addEventListener('change', () => {
	settingsGmailOptions.hidden = !settingsGmailEnabled.checked;
});

settingsForm.addEventListener('submit', async (e) => {
	e.preventDefault();
	if (!currentUser || !userSettings) return;

	const scanWindow = parseInt(document.getElementById('settings-scan-window').value, 10);
	const minConfidence = parseFloat(document.getElementById('settings-min-confidence').value);

	const update = {
		gmail_enabled: settingsGmailEnabled.checked,
		target_column: getPillValue(settingsTargetColumn) || null,
		scan_window_days: Number.isFinite(scanWindow) ? Math.min(30, Math.max(1, scanWindow)) : DEFAULT_SETTINGS.scan_window_days,
		min_confidence: Number.isFinite(minConfidence) ? Math.min(1, Math.max(0, minConfidence)) : DEFAULT_SETTINGS.min_confidence,
	};

	settingsStatus.textContent = 'Saving…';

	const { data, error } = await supabase
		.from('user_settings')
		.update(update)
		.eq('user_id', currentUser.id)
		.select()
		.single();

	if (error) {
		console.error('Error saving settings:', error);
		settingsStatus.textContent = 'Could not save — ' + error.message;
		return;
	}

	userSettings = data;
	settingsStatus.textContent = 'Saved.';
	setTimeout(() => { settingsStatus.textContent = ''; }, 2000);
});

document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
document.getElementById('close-settings-modal').addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', (e) => {
	if (e.target === settingsModal) closeSettingsModal();
});

// Copy / reveal buttons in the relay credentials block
settingsModal.addEventListener('click', (e) => {
	const copyBtn = e.target.closest('.btn-copy');
	if (copyBtn) {
		const field = document.getElementById(copyBtn.dataset.copyTarget);
		navigator.clipboard.writeText(field.value).then(() => {
			const original = copyBtn.textContent;
			copyBtn.textContent = 'Copied';
			setTimeout(() => { copyBtn.textContent = original; }, 1500);
		});
		return;
	}

	const revealBtn = e.target.closest('.btn-reveal');
	if (revealBtn) {
		const field = document.getElementById(revealBtn.dataset.revealTarget);
		const hidden = field.type === 'password';
		field.type = hidden ? 'text' : 'password';
		revealBtn.textContent = hidden ? 'Hide' : 'Show';
	}
});


/*
* Overflow menu (···)
*/
const overflowBtn = document.getElementById('btn-overflow');
const overflowMenu = document.getElementById('overflow-menu');

overflowBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = overflowMenu.classList.toggle('is-open');
  overflowBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

document.addEventListener('click', (e) => {
  if (overflowMenu.classList.contains('is-open') && !overflowBtn.closest('.overflow-menu-wrap').contains(e.target)) {
    overflowMenu.classList.remove('is-open');
    overflowBtn.setAttribute('aria-expanded', 'false');
  }
});

overflowMenu.addEventListener('click', () => {
  overflowMenu.classList.remove('is-open');
  overflowBtn.setAttribute('aria-expanded', 'false');
});

/* Data Persistence
---------------------------------------------------- */

// Auto-save to Supabase every 5 seconds (if logged in and board changed)
let saveInFlight = false;
const saveInterval = setInterval(async function () {
	if (!currentUser || !boardDirty || saveInFlight) return;
	saveInFlight = true;
	boardDirty = false;
	const success = await saveBoardToSupabase();
	if (!success) boardDirty = true; // retry on next tick
	saveInFlight = false;
}, 5000);

// Warn before leaving with unsaved changes (autosave runs every 5s, so a
// close/reload right after an edit can otherwise lose it silently)
window.addEventListener('beforeunload', (e) => {
	if (!boardDirty) return;
	e.preventDefault();
	e.returnValue = '';
});

// Initialize app - check auth state
checkAuth();

// Expose debugging functions globally
window.taskzDebug = {
	saveBoardToSupabase,
	loadBoardFromSupabase,
	getBoardData,
	getCurrentUser: () => currentUser,
	supabase
};
console.log('Taskz loaded. Debug with window.taskzDebug');

/*
* Auth Form Event Handlers
*/

const authForm = document.getElementById('auth-form');

// Password visibility toggle
document.querySelectorAll('.btn-toggle-password').forEach(function (btn) {
	btn.addEventListener('click', function () {
		const input = btn.previousElementSibling;
		const isPassword = input.type === 'password';
		input.type = isPassword ? 'text' : 'password';
		btn.textContent = isPassword ? 'Hide' : 'Show';
	});
});

// Sign In form submit
if (authForm) {
	const authSubmit = document.getElementById('auth-submit');
	const authError = document.getElementById('auth-error');

	authForm.addEventListener('submit', async function (e) {
		e.preventDefault();
		authError.style.display = 'none';
		authSubmit.disabled = true;
		authSubmit.textContent = 'Signing in…';

		const email = document.getElementById('auth-email').value;
		const password = document.getElementById('auth-password').value;
		const result = await signIn(email, password);

		if (result.error) {
			authError.textContent = result.error.message;
			authError.style.display = 'block';
			authSubmit.disabled = false;
			authSubmit.textContent = 'Sign In';
		}
	});
}

// Use event delegation for sign-out so it works regardless of load timing
document.addEventListener('click', function (e) {
	if (e.target.id === 'sign-out-btn' || e.target.closest('#sign-out-btn')) {
		signOut();
	}
});

// Burger menu toggle (mobile)
const burgerBtn = document.getElementById('burger-btn');
const appNavbar = document.querySelector('.app-navbar');

if (burgerBtn && appNavbar) {
	burgerBtn.addEventListener('click', function (e) {
		e.stopPropagation();
		const isOpen = appNavbar.classList.toggle('is-open');
		burgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
	});
}

// Close mobile menu when clicking outside the navbar
document.addEventListener('click', function (e) {
	if (appNavbar && appNavbar.classList.contains('is-open') && !appNavbar.contains(e.target)) {
		appNavbar.classList.remove('is-open');
		if (burgerBtn) burgerBtn.setAttribute('aria-expanded', 'false');
	}
});

// Close mobile menu when a nav action is triggered
document.addEventListener('click', function (e) {
	const closeTriggers = ['btn-trash', 'sign-out-btn', 'btn-settings', 'btn-info'];
	if (closeTriggers.some(id => e.target.id === id || e.target.closest('#' + id))) {
		if (appNavbar) appNavbar.classList.remove('is-open');
		if (burgerBtn) burgerBtn.setAttribute('aria-expanded', 'false');
	}
});

// Sign-up & password reset handlers (disabled — UI removed, kept for future use)
// let isSignUp = false;
// const authToggle = document.getElementById('auth-toggle');
// const authSubmit = document.getElementById('auth-submit');
// const authTitle = document.getElementById('auth-title');
// const forgotPasswordLink = document.getElementById('forgot-password-link');
// const resetPasswordForm = document.getElementById('reset-password-form');
// const resetPasswordView = document.getElementById('reset-password-view');
// const authFormView = document.getElementById('auth-form-view');
// const backToSignIn = document.getElementById('back-to-signin');
// const newPasswordView = document.getElementById('new-password-view');
// const newPasswordForm = document.getElementById('new-password-form');
//
// if (authToggle) {
//   authToggle.addEventListener('click', function(e) {
//     e.preventDefault();
//     isSignUp = !isSignUp;
//     authTitle.textContent = isSignUp ? 'Sign Up' : 'Sign In';
//     authSubmit.textContent = isSignUp ? 'Sign Up' : 'Sign In';
//     authToggle.textContent = isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up";
//   });
// }
//
// if (forgotPasswordLink) {
//   forgotPasswordLink.addEventListener('click', function(e) {
//     e.preventDefault();
//     authFormView.style.display = 'none';
//     resetPasswordView.style.display = 'block';
//   });
// }
//
// if (backToSignIn) {
//   backToSignIn.addEventListener('click', function(e) {
//     e.preventDefault();
//     resetPasswordView.style.display = 'none';
//     authFormView.style.display = 'block';
//   });
// }
//
// if (resetPasswordForm) {
//   resetPasswordForm.addEventListener('submit', async function(e) {
//     e.preventDefault();
//     const email = document.getElementById('reset-email').value;
//     const { error } = await supabase.auth.resetPasswordForEmail(email, {
//       redirectTo: window.location.origin,
//     });
//     if (error) {
//       alert('Error: ' + error.message);
//     } else {
//       alert('If an account with that email exists, a password reset link has been sent.');
//       resetPasswordView.style.display = 'none';
//       authFormView.style.display = 'block';
//     }
//   });
// }
//
// if (newPasswordForm) {
//   newPasswordForm.addEventListener('submit', async function(e) {
//     e.preventDefault();
//     const newPassword = document.getElementById('new-password').value;
//     const confirmPassword = document.getElementById('confirm-password').value;
//     if (newPassword.length < 6) {
//       alert('Password must be at least 6 characters.');
//       return;
//     }
//     if (newPassword !== confirmPassword) {
//       alert('Passwords do not match.');
//       return;
//     }
//     const { error } = await supabase.auth.updateUser({ password: newPassword });
//     if (error) {
//       alert('Error updating password: ' + error.message);
//     } else {
//       alert('Password updated successfully!');
//       isPasswordRecovery = false;
//       newPasswordView.style.display = 'none';
//       updateAuthUI();
//     }
//   });
// }
