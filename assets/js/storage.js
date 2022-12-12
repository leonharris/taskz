
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
