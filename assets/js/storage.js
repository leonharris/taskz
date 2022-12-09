// Store
//localStorage.setItem("lastname", "Smith");


/* localStorage JS
---------------------------------------------------- */

// Save page data to localStorage
// Run function every x seconds
const interval = setInterval(function() {
   //console.log('run');
   setTasks();
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

function setTasks() {

	let setTasks = [];

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
        setTasks.push({
            name: col_header_text,
            color: col_color,
            tasks: task_data
        });

        i++;
	}

	// Put the object into storage
	if (setTasks.length) {
        //console.log(setTasks);
        let jsonSetTasks = JSON.stringify(setTasks); // convert array to json
		localStorage.setItem('tasks', jsonSetTasks);
	}

}

function populateTasks() {

    // Retrieve the Tasks object from storage
	const retrievedTasks = localStorage.getItem('tasks');
    let tasks = JSON.parse(retrievedTasks);
    for (let col of tasks) {

        let col_name = col.name;
        let col_color = col.color;
        let task_items = col.tasks;

        addColumn(col_name, col_color);

        for (let task of task_items) {
            console.log(task);
            //addTask(taskListUL);
        }
    }

    // add the delete button after the board has been populated with content
    // running it sooner means the lists don't exist at runtime
    deleteList();

}
// build out the grid if items in localStorage
// run on page load
populateTasks();
