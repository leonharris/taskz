// iro.js
import iro from '@jaames/iro';
// sortableJS
import Sortable from 'sortablejs';

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
	let taskListUL = document.querySelectorAll('.tasks-list');
	for (let i=0;i<taskListUL.length;i++) {
		new Sortable(taskListUL[i], {
			animation: 300,
			group: 'task-list',
			store: {
				// Get the order of elements. Called once during initialization.
				get: function (sortable) {
					var order = localStorage.getItem(sortable.options.group.name);
					return order ? order.split('|') : [];
				},

				// Save the order of elements. Called onEnd (when the item is dropped).

				set: function (sortable) {
					var order = sortable.toArray();
					localStorage.setItem(sortable.options.group.name, order.join('|'));
				}
			}
		});
	};
}

// Add new List Column on form submit

function getStatusFormData(form) {
  let formData = new FormData(form);
  let blank_col =  true;
  let hex = colorPicker.color.hexString;
  if (!hex) {
	  hex = '#222';
  }
  createList(blank_col, formData.get('column_title'), hex);
}
document.getElementById("form--add-list").addEventListener("submit", function (event) {
  event.preventDefault();
  getStatusFormData(event.target);
  document.body.classList.remove('show-modal');
});



// Add task on "add task" button click
document.addEventListener('click',function(e){
	var add_task_links = document.getElementsByClassName('btn-add-task');
	for(var i = 0; i < add_task_links.length; i++) {
		var add_task_link = add_task_links[i];
		add_task_link.onclick = function(e) {
			let taskListUL = e.target.parentNode.parentNode.previousSibling;
			// Add blank task into list
			let empty_task = createTask("", "");
			taskListUL.appendChild(empty_task);
		}
	}
});



/*
* Create task
*/

function createTask(task_title, task_content) {

	// create task data
	let title_content = task_title ? task_title : "Task title";
	let content_content = task_content ? task_content : "Task content";

	// create task <li>
	let task_li = document.createElement("li");
	task_li.classList.add('task');

	// create task title
	let task_header = document.createElement("h3");
	task_header.classList.add('task--title');
	task_header.contentEditable = "true";
	let task_header_content = document.createTextNode(title_content);
	task_header.appendChild(task_header_content);
	task_li.appendChild(task_header);

	// create task content
	let task_content_div = document.createElement("div");
	task_content_div.classList.add('task--content');
	task_content_div.contentEditable = "true";
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

	// SortableJS
	new Sortable(board, {
		animation: 300,
		handle: '.handle',
		group: 'task-list',
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
	delete_list_btn.forEach(function(el) {
		el.addEventListener('click', function(e) {
			let parentList = el.closest('.status-column');
			let confirmation = confirm("Are you sure you want to delete this category?");
		    if(confirmation == true){
				parentList.remove();
		    }
		})
	});
}


// Delete task
function deleteTask() {
	let delete_list_btn = document.querySelectorAll('.btn-delete-task');
	delete_list_btn.forEach(function(el) {
		el.addEventListener('click', function(e) {
			let parentTask = el.closest('.task');
			let confirmation = confirm("Are you sure you want to delete this task?");
		    if(confirmation == true){
				parentTask.remove();
		    }
		})
	});
}



// Modals

const addListButton = document.querySelector('#add-list'); // add list button
const closeModalButton = document.querySelector('#close-modal');

// Event listeners
addListButton.addEventListener("click", openModal);
closeModalButton.addEventListener("click", closeModal);


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




/* localStorage JS
---------------------------------------------------- */

// Save page data to localStorage
// Run function every x seconds
const interval = setInterval(function() {
   //console.log('run');
   createLists_localStorage();
}, 5000);


function createLists_localStorage() {

	let createLists_localStorage = [];

	const col = document.querySelectorAll('.status-column');
    let i = 1;
	for (let list of col) {

		//console.log(item.id); // column/list id
		let list_id = list.id;
		let col = document.getElementById(list_id);
		let col_header_text = col.getElementsByTagName('header')[0].innerText;
		// Get the --status-color style for column
		var col_color = getComputedStyle(col).getPropertyValue('--status-color');

		// get the tasks
		let tasks = list.querySelectorAll('.task');

		// loop over the tasks
        // built the list tasks array
		const task_data = [];
        let ii = 1;
		for (let task of tasks) {
			let task_title_el = task.getElementsByClassName('task--title');
			let task__title = task_title_el[0].innerHTML;
			let task_content_el = task.getElementsByClassName('task--content');
			let task__content = task_content_el[0].innerHTML;
            //task_data.push('"' + ii + '": ["' + task__title + '","' + task__content + '"]');
            task_data.push({
                id: ii,
                task_title: task__title,
                task_content: task__content
            });
            ii++;
		}
        //console.log(task_data);

        // build the array
        createLists_localStorage.push({
            name: col_header_text,
            color: col_color,
            tasks: task_data
        });

        i++;
	}

	// Put the object into storage
	if (createLists_localStorage.length) {
        //console.log(createLists_localStorage);
        let jsonSetTasks = JSON.stringify(createLists_localStorage); // convert array to json
		localStorage.setItem('tasks', jsonSetTasks);
	}

}

function populateTasks() {

    // Retrieve the Tasks object from storage
	const retrievedTasks = localStorage.getItem('tasks');
    let tasks = JSON.parse(retrievedTasks);
    let i = 0;
    for (let col of tasks) {

        let col_name = col.name;
        let col_color = col.color;
        let task_items = col.tasks;

        let blank_col = false;
        createList(blank_col, col_name, col_color);

        var listCol = document.getElementsByClassName('tasks-list');

        for (let task of task_items) {

            // Add task into list
        	let task_li = createTask(task.task_title, task.task_content);
        	listCol[i].appendChild(task_li);

        }

        i++;

    }

    // add the delete buttons after the board has been populated with content
    // running it sooner means the lists don't exist at runtime
    deleteList();
    deleteTask();

    // activate Sortabel JS on all task lists
    activateSortable();

}

// build out the grid if items in localStorage
// run on page load
populateTasks();
