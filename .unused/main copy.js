// Store
//localStorage.setItem("lastname", "Smith");


/* localStorage JS
---------------------------------------------------- */

// Save page data to localStorage
// Run function every x seconds
const interval = setInterval(function() {
   console.log('run');
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

	var grid_wrapper = document.getElementById('board').children;
	for (var i = 0; i < grid_wrapper.length; i++) {

		let status = grid_wrapper[i];
		let id = status.id;
		let col = document.getElementById(id);
		let col_header_text = col.getElementsByTagName('header')[0].innerText;
		// Get the --status-color style for column
		var col_color = getComputedStyle(col).getPropertyValue('--status-color');

		jsonStatuses.push('"' + (i + 1) + '": {"name": "' + col_header_text + '","color": "' + col_color + '","tasks": {"1": ["Task title 1", "Task content 1"],"2": ["Task title 3", "Task content 3"]}');

	}

	//const file = JSON.parse(data);
	//file.events.push({"id": title1, "year": 2018, "month": 1, "day": 3});
	//file.events.push({"id": title2, "year": 2018, "month": 2, "day": 4});

	const json = JSON.stringify(jsonStatuses);

	console.log(json);

	/*
	if (jsonStatuses.length) {
		const obj = JSON.parse(jsonStatuses);
		localStorage.setItem('statuses', JSON.stringify(obj));
	}
	*/

	/*
	let jsonStatuses = '{ "statuses" : [' +
	'{ "status":"John" , "lastName":"Doe" },' +
	'{ "firstName":"Anna" , "lastName":"Smith" },' +
	'{ "firstName":"Peter" , "lastName":"Jones" }]}';*/
	//let jsonStatuses = '{ "statuses" : [' +
	//'{ "status":"John" , "lastName":"Doe" }]}';




	// Put the object into storage
	//localStorage.setItem('statusesObject', JSON.stringify(statusesObject));


	// Retrieve the object from storage
	//var retrievedObject = localStorage.getItem('testObject');

	//console.log('retrievedObject: ', JSON.parse(retrievedObject));

}



// Open modal
document.querySelector('button#add-list').addEventListener('click', e => {
  document.body.classList.add('show-modal');
})

// Close modal
document.querySelector('button#close-modal').addEventListener('click', e => {
  document.body.classList.remove('show-modal')
})


document.querySelector('.underlay').addEventListener('click', e => {
  document.body.classList.remove('show-modal')
})


function getStatusFormData(form) {

  var formData = new FormData(form);

  createStatusColumn(formData.get('column_title'), formData.get('column_color'));

}

// Add Status Column form submit (Modal)

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
		// Add blank task into column
		createTask(task_list);
    }
}
});



/* Create blank Column 
------------------------------------------------------------ */

function createStatusColumn(column_title, column_color) {

	var title = column_title;
	var color = column_color;
	const countStatusCols = document.querySelectorAll('.status-column').length;

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
	var header_text = document.createTextNode(column_title);
	column_header.appendChild(header_text);
	column_inner.appendChild(column_header);

	var task_list = document.createElement("div");
	task_list.classList.add('tasks-list');
	column_inner.appendChild(task_list);

	// Add blank task into column
	createTask(task_list);

	// Add status column footer
	var column_footer = document.createElement("footer");
	column_inner.appendChild(column_footer);


	// Add task button
	var btn_add_task = document.createElement("button");
	btn_add_task.classList.add('btn-add-task');
	var btn_text = document.createTextNode("+ Add task");
	btn_add_task.appendChild(btn_text);
	column_footer.appendChild(btn_add_task);

   	var element = document.getElementById("board");
   	element.appendChild(column);

}

/* Create a blank Task and attach to status column
---------------------------------------------------------*/
function createTask(element) {

	// create task div
	var task_div = document.createElement("div");
	task_div.classList.add('task');

	var task_header = document.createElement("h3");
	task_header.classList.add('task--title');
	var task_title = document.createTextNode("Task title");
	task_header.appendChild(task_title);
	task_div.appendChild(task_header);

	// task content
	var task_content = document.createElement("div");
	task_content.classList.add('task--content');
	var task_content_text = document.createTextNode("Task content");
	task_content.appendChild(task_content_text);

	task_div.appendChild(task_header);
	task_div.appendChild(task_content);
   	element.appendChild(task_div);

}


/*
fs.readFile('data/tasks.json', 'utf8', function (err, data) {

	console.log(data);

   	if (err) {

       console.log(err)

   	} else {

	   const file = JSON.parse(data);
       file.events.push({"id": title1, "year": 2018, "month": 1, "day": 3});
       file.events.push({"id": title2, "year": 2018, "month": 2, "day": 4});

       const json = JSON.stringify(file);

       fs.writeFile('data/tasks.json', json, 'utf8', function(err){

            if(err){
                console.log(err);
            } else {
                //Everything went OK!
    		}
		});
   	}

});

*/
