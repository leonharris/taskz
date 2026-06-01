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
	boardSortable = null;
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
	console.log('Auth state change:', event);
	currentUser = session?.user || null;
	updateAuthUI();

	// Don't await DB calls here — it deadlocks the Supabase client.
	if (currentUser && !boardLoaded) {
		boardLoaded = true;
		loadBoardFromSupabase(); // fire-and-forget (no await)
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
	}
}

/*
* Supabase Data Functions
*/

// Save board to Supabase
async function saveBoardToSupabase() {
	if (!currentUser) return;

	const boardData = getBoardData();
	if (!boardData.columns.length && !boardData.archived.length) return;

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
		} else {
			lastSavedAt = now;
		}
	} catch (err) {
		console.error('saveBoardToSupabase threw:', err);
	}
}

// Load board from Supabase
async function loadBoardFromSupabase() {
	if (!currentUser) return;

	try {
		console.log('Loading board for user:', currentUser.id);
		const { data: board, error } = await supabase
			.from('boards')
			.select('data')
			.eq('user_id', currentUser.id)
			.single();

		console.log('Load result:', { board, error });

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
			console.log('Populating board with', columns.length, 'columns,', archivedTasks.length, 'archived tasks');
			// Clear existing board
			document.getElementById('board').innerHTML = '';
			// Populate from Supabase data
			populateTasksFromData(columns);
			subscribeToBoardChanges();
		} else {
			console.log('No board data found');
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
			let task_content_el = task.getElementsByClassName('task--content');
			let task__content = task_content_el[0].textContent;
			task_data.push({
				id: ii,
				task_title: task__title,
				task_content: task__content,
				priority: task.dataset.priority || 'none'
			});
			ii++;
		}

		boardData.push({
			name: col_header_text,
			color: col_color,
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
		createList(blank_col, col_name, col_color);

		var listCol = document.getElementsByClassName('tasks-list');

		for (let task of task_items) {
			let task_li = createTask(task.task_title, task.task_content, task.priority);
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
			store: {
				get: (sortable) => {
					const order = localStorage.getItem(sortable.options.group.name);
					return order ? order.split('|') : [];
				},
				set: (sortable) => {
					const order = sortable.toArray();
					localStorage.setItem(sortable.options.group.name, order.join('|'));
				}
			}
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
		taskListUL.appendChild(emptyTask);
		openTaskDetailModal(emptyTask);
	}
});



/*
* Create task
*/

function createTask(task_title, task_content, task_priority) {

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
	let task_content_text = document.createTextNode(content_content);
	task_content_div.appendChild(task_content_text);
	task_li.appendChild(task_content_div);

	// return the <li class="task">
	return task_li;

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

function createList(blank_col, column_title, column_color) {

	const board = document.getElementById("board");

	// create task div
	let column = document.createElement("div");
	column.setAttribute("id", nextColumnId());
	column.classList.add('status-column');
	column.style.setProperty('--status-color', column_color);
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
				task_content: parentTask.querySelector('.task--content').textContent,
				priority: parentTask.dataset.priority || 'none',
				column: colName,
				archivedAt: new Date().toISOString()
			});
			parentTask.remove();
			markDirty();
		}
	}
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
			task_content: task.querySelector('.task--content').textContent,
			priority: task.dataset.priority || 'none',
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
});


/*
* Task Detail Modal
*/
const taskDetailModal = document.getElementById('modal--task-detail');
const taskDetailForm = document.getElementById('form--task-detail');
const taskDetailTitle = document.getElementById('task-detail-title');
const taskDetailStatus = document.getElementById('task-detail-status');
const taskDetailPriority = document.getElementById('task-detail-priority');
const taskDetailDescription = document.getElementById('task-detail-description');
let activeTask = null; // the <li> currently being edited

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
	taskDetailDescription.value = taskEl.querySelector('.task--content').textContent;
	taskDetailPriority.value = taskEl.dataset.priority || 'none';

	// Populate status dropdown with current columns
	taskDetailStatus.innerHTML = '';
	const columns = document.querySelectorAll('.status-column');
	const currentColumn = taskEl.closest('.status-column');
	columns.forEach((col) => {
		const name = col.querySelector('.status-column--header span[contenteditable]').textContent;
		const option = document.createElement('option');
		option.value = col.id;
		option.textContent = name;
		if (col === currentColumn) option.selected = true;
		taskDetailStatus.appendChild(option);
	});

	taskDetailModal.classList.add('is-visible');
}

function closeTaskDetailModal() {
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

	// Update task title
	activeTask.querySelector('.task--title').textContent = taskDetailTitle.value;

	// Update task content
	activeTask.querySelector('.task--content').textContent = taskDetailDescription.value;

	// Update priority
	const newPriority = taskDetailPriority.value;
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

	// Move task to new column if status changed
	const targetColumnId = taskDetailStatus.value;
	const currentColumn = activeTask.closest('.status-column');
	if (currentColumn && currentColumn.id !== targetColumnId) {
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
    const taskEl = createTask(task.task_title, task.task_content, task.priority);
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
const saveInterval = setInterval(function () {
	if (currentUser && boardDirty) {
		boardDirty = false;
		saveBoardToSupabase();
	}
}, 5000);

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
