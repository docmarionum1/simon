var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var path = require('path');

games = {};

function newGame() {
	var code = generateRoomPassword();

	var game = {
		colors: ["fuchsia", "aqua", "lime", "silver", "purple", "yellow", "orange", "green", "red", "blue"],
		players: {},
		started: false,
		state: "playPattern",
		current_pattern: [],
		current_player_input: [],
		round: 0,
		round_start_time: null,
		score: 0,
		password: code
	};

	games[code] = game;

	console.log("new Game");
	console.log(game);

	return game;
}

function generateRoomPassword() {
	while (true) {
		var code = Math.floor(Math.random() * 1024);
		if (!(code in games)) {
			return code;
		}
	}
}

function joinGame(player, game, color) {
	player.color = color;
	player.game = game;
	game.players[player.color] = player;
	player.socket.join(game.password);

	player.socket.emit('join', {color: player.color, password: game.password});

	player.socket.emit('message', {
		message: "Hold to start",
		location: "#center",
		fade: null
	});

	console.log("Join Game");
	console.log(game);
}


app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', function(socket) {
	var player = {
		game: null, color: null, socket: socket, 
		mousedown: false, last_activity: new Date()
	};

	socket.on('newGame', function() {
		player.last_activity = new Date();

		var game = newGame();
		var color = game.colors.pop();
		joinGame(player, game, color);
	});

	socket.on('joinGame', function(password) {
		player.last_activity = new Date();
		console.log(password);
		if (password in games) {
			var game = games[password];
			if (!game.started) {
				var color = game.colors.pop();
				if (color) {
					joinGame(player, game, color);
				} else {
					//TODO
					//Room is full
				}

			} else {
				//TODO
				//Error, game aleady started
			}
		} else  {
			console.log("clearPasswrod");
			socket.emit('clearPassword');
		}
		
	});

	socket.on('disconnect', function() {
		disconnectPlayer(player);
	});

	socket.on('leave', function() {
		leaveGame(player);
	})

	socket.on('mousedown', function() {
		console.log(player.color + " mousedown");
		player.mousedown = true;
		player.last_activity = new Date();
		
		if (player.game && !player.game.started && allButtonsDown(player.game)) {
			resetGame(player.game);
			startGame(player.game);
		} else if (player.game && player.game.started && player.game.state == "readPattern") {
			player.game.current_player_input.push(player.color);
			validatePattern(player.game);
		}
	});

	socket.on('mouseup', function() {
		player.mousedown = false;
		player.last_activity = new Date();
		console.log(player.color + " mouseup");
	});
});

function disconnectPlayer(player) {
	player.socket.emit('message', {
		message: "Disconnected.  Reload.",
		location: "#center",
		fade: null
	});
	player.socket.removeAllListeners();

	leaveGame(player);
	delete player;
}

function leaveGame(player) {
	if (player.game) {
		var game = player.game;
		
		delete game.players[player.color];	
		game.colors.push(player.color);
		console.log(player.color + " left");

		player.game = null;
		player.color = null;

		if (Object.keys(game.players).length == 0) {
			delete games[game.password];
			console.log("Game deleted");
			console.log(games);
		} else if (game.started) {
			//Handle disconnect in the middle of a game
			//Right now kick everyone - TODO reset game but not kick.
			for (player in game.players) {
				disconnectPlayer(game.players[player]);
			}
		}
	}
}

var kick_time = 100000;
function autoKickPlayers() {
	var current_time = new Date();
	for (game in games) {
		//TODO Don't kick players in active games
		for (player in games[game].players) {
			if (current_time - games[game].players[player].last_activity >= kick_time) {
				disconnectPlayer(games[game].players[player]);
			}
		}
	}
}

setInterval(autoKickPlayers, 5000);

http.listen(1337, function() {
    console.log('Listening on 1337');
});

function allButtonsDown(game){ 
	var down = true;
	for (player in game.players) {
		down &= game.players[player].mousedown;
	}
	return down;
}

function clearScreen(game){
	io.to(game.password).emit('message',  {
		message: "",
		location: "#center",
		fade: null
	});
	io.to(game.password).emit('message',  {
		message: "",
		location: "#top",
		fade: null
	});
	io.to(game.password).emit('message',  {
		message: "",
		location: "#bottom",
		fade: null
	});
}

var countdown_delay = 1000;
function countDown(game, n, endMessage, callback) {
	if (n < 0) {
		if (endMessage) {
			io.to(game.password).emit('message', {
				message: endMessage,
				location: "#center",
				fade: countdown_delay
			});

			if (callback) {
				setTimeout(function() {callback();}, countdown_delay);
			}

		} else if (callback) {
			callback();
		}
		return;
	}
	io.to(game.password).emit('message', {
		message: n,
		location: "#center",
		fade: countdown_delay
	});
	setTimeout(
		function() {countDown(game, n-1, endMessage, callback);}, 
		countdown_delay
	);
}

function startGame(game) {
	game.started = true;
	clearScreen(game);
	io.to(game.password).emit('start');
	setTimeout(function() {
		countDown(game, 3, "Start!", function() {nextRound(game);});
	}, 1000);
}

function nextRound(game) {
	console.log("Start Round");
	game.round += 1;
	game.current_player_input = [];
	var colors = Object.keys(game.players);
	game.current_pattern.push(colors[Math.floor(Math.random() * colors.length)]);
	game.state = "playPattern";
	playPattern(game, 0);
}

function validatePattern(game) {
	for (var i = 0; i < game.current_player_input.length; i++) {
		if (game.current_pattern[i] != game.current_player_input[i]) {
			//Error! Emit flash and display score, set game playing to stopped and hold to start again.
			game.started = false;
			io.to(game.password).emit('flash');

			io.to(game.password).emit('message', {
				message: "Hold to start",
				location: "#center",
				fade: null
			});

			io.to(game.password).emit('message', {
				message: game.score,
				location: "#bottom",
				fade: null
			});

			io.to(game.password).emit('gameOver');

			return;
		}
	}

	if (game.current_player_input.length == game.current_pattern.length) {
		game.state = "playPattern";
		game.score += Math.round(((game.round*10000000)/((new Date()) - game.round_start_time))*Math.pow(1.5,game.round));
		var break_time = 5000;
		io.to(game.password).emit('message', {
			message: game.score,
			location: "#center",
			fade: break_time
		});

		setTimeout(function() {
			nextRound(game);
		}, break_time+2000);
	} 
}


function playPattern(game, i) {
	if (i == game.current_pattern.length) {
		game.state = "readPattern";
		game.round_start_time = new Date();
		console.log(game);
	} else{
		try {
			var player_socket = game.players[game.current_pattern[i]].socket;
		} catch (e) {
			//Player is gone! Freak out!
			return;
		}
		player_socket.emit('lightUp');

		game.cancelCurrentAction = function() {
			player_socket.removeListener('lightUpFinish', callback);
		};
		
		var callback = function() {
			player_socket.removeListener('lightUpFinish', callback);
			playPattern(game, i+1);
		};

		player_socket.on('lightUpFinish', callback);
	}
}

function resetGame(game) {
	game.started = false;
	game.score = 0;
	game.round = 0;
	game.state = "playPattern";
	game.current_pattern = [];
	game.current_player_input = [];
}