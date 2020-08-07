const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('public'));
app.use('/scripts', express.static(__dirname + '/node_modules'));

var roomUserCounts = {}; // map from rooms to user counts
var socketRooms = {}; // map from sockets to rooms

// Signaling handlers

io.on('connection', socket => {
    console.log('a user connected');
    io.emit('room count', {
        counts: roomUserCounts,
    });

    socket.on('disconnect', () => {
        console.log('a user disconnected');
        
        if (socketRooms[socket.id]) {
            roomUserCounts['' + socketRooms[socket.id]] -= 1
        }

        socket.emit('room count', {
            counts: roomUserCounts,
        });

        socket.disconnect();
    });

    socket.on('create or join', room => {
        let myRoom = io.sockets.adapter.rooms[room] || { length: 0};
        let numClients = myRoom.length;
        console.log(room, 'has', numClients, 'clients');
        
        if (numClients < 2) {

            if (socketRooms[socket.id] && socketRooms[socket.id] != room) {
                // Changing rooms
                roomUserCounts[socketRooms[socket.id]] -= 1;
                socket.leave(socketRooms[socket.id]);
            } else if (socketRooms[socket.id]) {
                // Same room, do nothing
                return
            }
            
            // Standard room-joining procedure
            roomUserCounts[room] = numClients + 1;
            socketRooms[socket.id] = room

            if (numClients == 0) {
                socket.emit('created', room);
            } else {
                socket.emit('joined', room);
            }

            socket.join(room);
            io.emit('room count', {
                counts: roomUserCounts,
            });
        } else {
            socket.emit('full', room)
        }
    });

    // Re-broadcasters

    socket.on('ready', room => {
        socket.broadcast.to(room).emit('ready');
    });

    socket.on('candidate', event => {
        socket.broadcast.to(event.room).emit('candidate', event);
    });

    socket.on('offer', event => {
        socket.broadcast.to(event.room).emit('offer', event.sdp);
    });

    socket.on('answer', event => {
        socket.broadcast.to(event.room).emit('answer', event.sdp);
    });
    
    socket.on('recording', room => {
        socket.to(room).emit('recording', room);
    });

    socket.on('stop recording', room => {
        socket.to(room).emit('stop recording', room);
    });
});

// listener
http.listen(3000, () => {
    console.log('listening on *:3000');
})

