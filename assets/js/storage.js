// Store
//localStorage.setItem("lastname", "Smith");


/* localStorage JS
---------------------------------------------------- */

// Save page data to localStorage
// Run function every x seconds
const interval = setInterval(function() {
   //console.log('run');
   getStatuses();
}, 5000);


/*
example JSON

{
	"col_1": {
		"name": "Status name",
		"color": "#222222",
		"tasks": {
			"1": ["Task title 1", "Task content 1"],
			"2": ["Task title 3", "Task content 3"]
		}
	},
	"col_2": {
		"name": "Status name 2",
		"color": "#444",
		"tasks": {
			"1": ["Task title 2", "Task content 2"]
		}
	}
}

*/

// https://codepen.io/LuisAFK/pen/ZEKLLEZ

function getStatuses() {

	let jsonStatuses = [];

	//var col = document.getElementById('board').children;
	const col = document.querySelectorAll('.status-column');

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
		//const task_data = [];
		for (let task of tasks) {
			//console.log(task);
			let task_title_el = task.getElementsByClassName('task--title');
			let title = task_title_el[0].innerHTML;
			console.log(title);
			let task_content_el = task.getElementsByClassName('task--content');
			let content = task_content_el[0].innerHTML;
			console.log(content);
		}

		// build the json
		//jsonStatuses.push('"' + (i + 1) + '": {"name": "' + col_header_text + '","color": "' + col_color + '","tasks": {"1": ["Task title 1", "Task content 1"],"2": ["Task title 3", "Task content 3"]}');

	}

	/*
	for (var i = 0; i < col.length; i++) {

		console.log('col-' + i);

		let status = col[i];
		let id = status.id;
		let col = document.getElementById(id);
		let col_header_text = col.getElementsByTagName('header')[0].innerText;
		// Get the --status-color style for column
		var col_color = getComputedStyle(col).getPropertyValue('--status-color');

		// loop over the tasks
		let tasks = status.querySelectorAll('.task');
		//console.log(tasks);
		for (var i = 0; i < tasks.length; i++) {
			console.log(tasks[0]);
			let task_title_el = tasks[i].getElementsByClassName('task--title');
			//let title = task_title_el[0].innerHTML;
			//console.log(task_title_el);
			let task_content_el = tasks[i].getElementsByClassName('task--content');
			//let content = task_content_el[0].innerHTML;
			//console.log(task_content_el);
		}


		jsonStatuses.push('"' + (i + 1) + '": {"name": "' + col_header_text + '","color": "' + col_color + '","tasks": {"1": ["Task title 1", "Task content 1"],"2": ["Task title 3", "Task content 3"]}');

	}
	*/

	//const json = JSON.stringify(jsonStatuses);
	const json = jsonStatuses;

	//console.log(json);

	// Put the object into storage
	if (json.length) {
		localStorage.setItem('toDoList', json);
	}

	/*

	// Retrieve the object from storage
	//var retrievedObject = localStorage.getItem('testObject');

	//console.log('retrievedObject: ', JSON.parse(retrievedObject));
	*/
}
