// iro.js
import iro from '@jaames/iro';
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
	console.log('Attempting sign in with:', email);
	const { data, error } = await supabase.auth.signInWithPassword({
		email,
		password,
	});
	if (error) {
		console.error('Sign in error:', error);
		alert('Error signing in: ' + error.message);
		return null;
	}
	console.log('Sign in successful:', data);
	return data;
}

// Sign out
async function signOut() {
	// Clear UI immediately — don't wait for Supabase (signOut hangs sometimes)
	currentUser = null;
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
	if (!boardData.length) return;

	console.log('Saving board data:', boardData);

	try {
		// Check if user already has a board
		console.log('Fetching existing board for user:', currentUser.id);
		const { data: existingBoard, error: fetchError } = await supabase
			.from('boards')
			.select('id')
			.eq('user_id', currentUser.id)
			.single();

		console.log('Fetch result:', { existingBoard, fetchError });

		if (fetchError && fetchError.code !== 'PGRST116') {
			console.error('Error fetching board:', fetchError);
			return;
		}

		if (existingBoard) {
			// Update existing board
			console.log('Updating board:', existingBoard.id);
			const { error: updateError } = await supabase
				.from('boards')
				.update({ data: boardData, updated_at: new Date().toISOString() })
				.eq('id', existingBoard.id);

			if (updateError) {
				console.error('Error updating board:', updateError);
			} else {
				console.log('Board updated successfully');
			}
		} else {
			// Insert new board
			console.log('Inserting new board');
			const { error: insertError } = await supabase
				.from('boards')
				.insert({ user_id: currentUser.id, data: boardData });

			if (insertError) {
				console.error('Error inserting board:', insertError);
			} else {
				console.log('Board inserted successfully');
			}
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
			console.log('Populating board with', board.data.length, 'columns');
			// Clear existing board
			document.getElementById('board').innerHTML = '';
			// Populate from Supabase data
			populateTasksFromData(board.data);
		} else {
			console.log('No board data found');
		}
	} catch (err) {
		console.error('loadBoardFromSupabase threw:', err);
	}
}

// Get current board data as JSON
function getBoardData() {
	let boardData = [];
	const col = document.querySelectorAll('.status-column');

	for (let list of col) {
		let list_id = list.id;
		let col_el = document.getElementById(list_id);
		let col_header_text = col_el.getElementsByTagName('header')[0].innerText;
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

	return boardData;
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

	deleteList();
	activateSortable();
}

/*
* Iro Colour Picker
* Used to set list colour
*/
var colorPicker = new iro.ColorPicker("#color-picker", {
	// Set the size of the color color-picker
	width: 300,
	// Set the initial color to pure red
	color: "#f00"
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
			group: 'task-list',
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

// Add new List Column on form submit

function getStatusFormData(form) {
	const formData = new FormData(form);
	const columnTitle = formData.get('column_title');
	const hex = colorPicker.color.hexString || '#222';
	createList(true, columnTitle, hex);
}

document.getElementById("form--add-list").addEventListener("submit", (event) => {
	event.preventDefault();
	getStatusFormData(event.target);
	closeModal();
});


// Add task on "add task" button click
document.addEventListener('click', (e) => {
	if (e.target.classList.contains('btn-add-task')) {
		const taskListUL = e.target.parentNode.parentNode.previousSibling;
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

	// Priority badge
	if (priority && priority !== "none") {
		let priority_div = document.createElement("div");
		priority_div.classList.add('task--tags');
		priority_div.innerHTML = `<span class="task--tag task--tag-${priority}">${priority}</span>`;
		task_li.appendChild(priority_div);
	}

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

	// Delete task button
	let btn_delete_task = document.createElement("div");
	btn_delete_task.classList.add('btn-delete-task-wrap');
	btn_delete_task.innerHTML = '<button class="btn-action btn-delete-task"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 512c141.4 0 256-114.6 256-256S397.4 0 256 0 0 114.6 0 256s114.6 256 256 256zm-72-280h144c13.3 0 24 10.7 24 24s-10.7 24-24 24H184c-13.3 0-24-10.7-24-24s10.7-24 24-24z"/></svg></button>';
	task_li.appendChild(btn_delete_task);

	// return the <li class="task">
	return task_li;

}



// Add Column
// Adds new list column

function createList(blank_col, column_title, column_color) {

	const countStatusCols = document.querySelectorAll('.status-column').length;
	const board = document.getElementById("board");

	const title = column_title;
	const color = column_color;

	// create task div
	let column = document.createElement("div");
	column.setAttribute("id", "status_" + (countStatusCols + 1));
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
	column_header.appendChild(header_text);

	// Edit list button
	let btn_edit_list = document.createElement("button");
	btn_edit_list.classList.add('btn-action', 'btn-edit-list');
	btn_edit_list.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M441 58.9L453.1 71c9.4 9.4 9.4 24.6 0 33.9L424 134.1 377.9 88 407 58.9c9.4-9.4 24.6-9.4 33.9 0zM209.8 256.2L344 121.9 390.1 168 255.8 302.2c-2.9 2.9-6.5 5-10.4 6.1l-58.5 16.7 16.7-58.5c1.1-3.9 3.2-7.5 6.1-10.4zM373.1 25L175.8 222.2c-8.7 8.7-15 19.4-18.3 31.1l-28.6 100c-2.4 8.4-.1 17.4 6.1 23.6s15.2 8.5 23.6 6.1l100-28.6c11.8-3.4 22.5-9.7 31.1-18.3L487 138.9c28.1-28.1 28.1-73.7 0-101.8L474.9 25C446.8-3.1 401.2-3.1 373.1 25zM88 64C39.4 64 0 103.4 0 152V424c0 48.6 39.4 88 88 88H360c48.6 0 88-39.4 88-88V312c0-13.3-10.7-24-24-24s-24 10.7-24 24V424c0 22.1-17.9 40-40 40H88c-22.1 0-40-17.9-40-40V152c0-22.1 17.9-40 40-40H200c13.3 0 24-10.7 24-24s-10.7-24-24-24H88z"/></svg>';
	column_header.appendChild(btn_edit_list);

	// add the html into the list <header>
	column_inner.appendChild(column_header);

	const task_list = document.createElement("ul");
	task_list.classList.add('tasks-list');
	column_inner.appendChild(task_list);

	// Add blank task into list,
	// not if calling from local Storage
	if (blank_col == true) {
		let empty_task = createTask("", "");
		task_list.appendChild(empty_task);
	}

	// Add status column footer
	let column_footer = document.createElement("footer");
	column_footer.classList.add('status-column--footer');
	column_inner.appendChild(column_footer);


	// Add task button
	let btn_add_task = document.createElement("div");
	btn_add_task.classList.add('btn-wrap');
	btn_add_task.innerHTML = '<button class="btn-action btn-add-task"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M432 256C432 264.8 424.8 272 416 272h-176V448c0 8.844-7.156 16.01-16 16.01S208 456.8 208 448V272H32c-8.844 0-16-7.15-16-15.99C16 247.2 23.16 240 32 240h176V64c0-8.844 7.156-15.99 16-15.99S240 55.16 240 64v176H416C424.8 240 432 247.2 432 256z"/></svg> Add task</button>';
	column_footer.appendChild(btn_add_task);

	// Delete list button
	let btn_delete_list = document.createElement("div");
	btn_delete_list.classList.add('btn-wrap');
	btn_delete_list.innerHTML = '<button class="btn-action btn-delete-list"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M432 64C440.8 64 448 71.16 448 80C448 88.84 440.8 96 432 96H413.7L388.2 452.6C385.9 486.1 357.1 512 324.4 512H123.6C90.01 512 62.15 486.1 59.75 452.6L34.29 96H16C7.164 96 0 88.84 0 80C0 71.16 7.164 64 16 64H111.1L137 22.56C145.8 8.526 161.2 0 177.7 0H270.3C286.8 0 302.2 8.526 310.1 22.56L336.9 64H432zM177.7 32C172.2 32 167.1 34.84 164.2 39.52L148.9 64H299.1L283.8 39.52C280.9 34.84 275.8 32 270.3 32H177.7zM381.6 96H66.37L91.67 450.3C92.87 467 106.8 480 123.6 480H324.4C341.2 480 355.1 467 356.3 450.3L381.6 96z"/></svg> Delete category</button>';
	column_footer.appendChild(btn_delete_list);

	board.appendChild(column);

	// SortableJS — column reordering (separate group from task lists)
	new Sortable(board, {
		animation: 300,
		handle: '.handle',
		draggable: '.status-column',
	})

	// clear input fields after adding a new list
	//todoInput.value = "";

	//deleteList();
	deleteTask();

}


/*
* Delete buttons
------------------------------------------- */

// Delete list
function deleteList() {
	let delete_list_btn = document.querySelectorAll('.btn-delete-list');
	delete_list_btn.forEach(function (el) {
		el.addEventListener('click', function (e) {
			let parentList = el.closest('.status-column');
			let confirmation = confirm("Are you sure you want to delete this category?");
			if (confirmation == true) {
				parentList.remove();
			}
		})
	});
}


// Delete task
function deleteTask() {
	let deleteButtons = document.querySelectorAll('.btn-delete-task');
	deleteButtons.forEach(function (button) {
		button.addEventListener('click', function () {
			let parentTask = button.closest('.task');
			if (parentTask) {
				let confirmation = confirm("Are you sure you want to delete this task?");
				if (confirmation) {
					parentTask.remove();
				}
			}
		});
	});
}


// Modals

const addListModal = document.getElementById('modal--add-list');
const addListButton = document.querySelector('#add-list'); // add list button
const closeModalButton = document.querySelector('#close-modal');

// Event listeners
addListButton.addEventListener("click", openModal);
closeModalButton.addEventListener("click", closeModal);

// Open modal
function openModal() {
	addListModal.classList.add('is-visible');
}
// Close modal
function closeModal() {
	addListModal.classList.remove('is-visible');
}
// Close modal on backdrop click
addListModal.addEventListener('click', (e) => {
	if (e.target === addListModal) {
		closeModal();
	}
})


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
	// Update or create priority tag
	let tagsDiv = activeTask.querySelector('.task--tags');
	if (newPriority && newPriority !== 'none') {
		if (!tagsDiv) {
			tagsDiv = document.createElement('div');
			tagsDiv.classList.add('task--tags');
			activeTask.insertBefore(tagsDiv, activeTask.firstChild);
		}
		tagsDiv.innerHTML = `<span class="task--tag task--tag-${newPriority}">${newPriority}</span>`;
	} else if (tagsDiv) {
		tagsDiv.remove();
	}

	// Move task to new column if status changed
	const targetColumnId = taskDetailStatus.value;
	const currentColumn = activeTask.closest('.status-column');
	if (currentColumn && currentColumn.id !== targetColumnId) {
		const targetList = document.getElementById(targetColumnId).querySelector('.tasks-list');
		targetList.appendChild(activeTask);
	}

	closeTaskDetailModal();
});


/* Data Persistence
---------------------------------------------------- */

// Auto-save to Supabase every 5 seconds (if logged in)
const saveInterval = setInterval(function () {
	console.log('Auto-save check - User:', currentUser ? currentUser.email : 'not logged in');
	if (currentUser) {
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
	authForm.addEventListener('submit', async function (e) {
		e.preventDefault();
		const email = document.getElementById('auth-email').value;
		const password = document.getElementById('auth-password').value;
		await signIn(email, password);
	});
}

// Use event delegation for sign-out so it works regardless of load timing
document.addEventListener('click', function (e) {
	if (e.target.id === 'sign-out-btn' || e.target.closest('#sign-out-btn')) {
		signOut();
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
