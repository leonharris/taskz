// @REF: https://stackoverflow.com/questions/60592825/sortablejs-isnt-saving-my-sorted-todo-list-in-localstorage


// SortableJS
// Set initial sorting for Task lists on screen
const taskList = document.querySelectorAll('.tasks-list');
for (i=0;i<taskList.length;i++) {
	new Sortable(taskList[i], {
		animation: 300,
		group: 'task-list',
		store: {
			/**
			 * Get the order of elements. Called once during initialization.
			 * @param   {Sortable}  sortable
			 * @returns {Array}
			 */
			get: function (sortable) {
				var order = localStorage.getItem(sortable.options.group.name);
				return order ? order.split('|') : [];
			},

			/**
			 * Save the order of elements. Called onEnd (when the item is dropped).
			 * @param {Sortable}  sortable
			 */
			set: function (sortable) {
				var order = sortable.toArray();
				localStorage.setItem(sortable.options.group.name, order.join('|'));
			}
		}
	});
};

// Add new List on form submit

function getStatusFormData(form) {
  var formData = new FormData(form);
  addColumn(formData.get('column_title'), formData.get('column_color'));
}
document.getElementById("form--add-list").addEventListener("submit", function (event) {
  event.preventDefault();
  getStatusFormData(event.target);
  document.body.classList.remove('show-modal');
});



// Add task on "add task" button click
document.addEventListener('click',function(e){
	var anchors = document.getElementsByClassName('btn-add-task');
	for(var i = 0; i < anchors.length; i++) {
		var anchor = anchors[i];
		anchor.onclick = function(e) {
			var task_list = e.target.parentNode.previousSibling;
			// Add blank task into list
			addTask(task_list);
		}
	}
});


// Add Task
// attach to status column

function addTask(taskList) {

	// create task div
	var task_div = document.createElement("li");
	task_div.classList.add('task');

	var task_header = document.createElement("h3");
	task_header.classList.add('task--title');
	task_header.contentEditable = "true";
	var task_title = document.createTextNode("Task title");
	task_header.appendChild(task_title);
	task_div.appendChild(task_header);

	// task content
	var task_content = document.createElement("div");
	task_content.classList.add('task--content');
	task_content.contentEditable = "true";
	var task_content_text = document.createTextNode("Task content");
	task_content.appendChild(task_content_text);

	task_div.appendChild(task_header);
	task_div.appendChild(task_content);
   	taskList.appendChild(task_div);


	// SortableJS
	new Sortable(taskList, {
		animation: 300,
		group: 'task-list',
		store: {
			/**
			 * Save the order of elements. Called onEnd (when the item is dropped).
			 */
			set: function (sortable) {
				var order = sortable.toArray();
				localStorage.setItem(sortable.options.group.name, order.join('|'));
			}
		}
	});
}


// Add Column
// Adds new list column

function addColumn(column_title, column_color) {

	const countStatusCols = document.querySelectorAll('.status-column').length;
	const board = document.getElementById("board");

	const title = column_title;
	const color = column_color;

	// create task div
	var column = document.createElement("div");
	column.setAttribute("id", "status_" + (countStatusCols + 1));
	column.classList.add('status-column');
	column.style.setProperty('--status-color', column_color);
	var column_inner = document.createElement("div");
	column_inner.classList.add('status-column--wrap');
	column.appendChild(column_inner);

	var column_header = document.createElement("header");
	column_header.classList.add('status-column--header');

	var header_handle = document.createElement("span");
	header_handle.classList.add('handle');
	column_header.appendChild(header_handle);

	var header_text = document.createElement("span");
	const title_text = document.createTextNode(column_title);
	header_text.appendChild(title_text);
	header_text.contentEditable = "true";
	column_header.appendChild(header_text);

	// add the html into the list <header>
	column_inner.appendChild(column_header);

	const task_list = document.createElement("ul");
	task_list.classList.add('tasks-list');
	column_inner.appendChild(task_list);

	// Add blank task into column
	addTask(task_list);

	// Add status column footer
	var column_footer = document.createElement("footer");
	column_inner.appendChild(column_footer);


	// Add task button
	var btn_add_task = document.createElement("button");
	btn_add_task.classList.add('btn-add-task');
	var btn_text = document.createTextNode("+ Add task");
	btn_add_task.appendChild(btn_text);
	column_footer.appendChild(btn_add_task);

   	board.appendChild(column);

	// SortableJS
	new Sortable(board, {
		animation: 300,
		handle: '.handle',
		group: 'task-list',
	})

	// clear input fields after adding a new list
	//todoInput.value = "";

}


// Modals


//const todoInput = document.querySelector(".todos-input"); //input for adding a todo
const addListButton = document.querySelector('#add-list'); // add list button
const closeModalButton = document.querySelector('#close-modal');
//const todoList = document.querySelector(".todos-list"); // the todo-list


// Event listeners
addListButton.addEventListener("click", openModal);
closeModalButton.addEventListener("click", closeModal);
//todoList.addEventListener("click", deleteTodo);
//todoList.addEventListener("click", completeTodo);


// Open modal
function openModal() {
	document.body.classList.add('show-modal');
}
// Close modal
function closeModal() {
	document.body.classList.remove('show-modal');
}
// Close modal - underlay click
document.querySelector('.underlay').addEventListener('click', e => {
  document.body.classList.remove('show-modal')
})
