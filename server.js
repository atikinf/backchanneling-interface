const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('public'));
app.use('/scripts', express.static(__dirname + '/node_modules'));

// Signaling handlers

io.on('connection', socket => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('a user disconnected');
    });

    socket.on('create or join', room => {
        let myRoom = io.sockets.adapter.rooms[room] || { length: 0};
        let numClients = myRoom.length;
        console.log(room, 'has', numClients, 'clients');    
    
        if (numClients == 0) {
            socket.join(room);
            socket.emit('created', room);
        } else if (numClients == 1) {
            socket.join(room);
            socket.emit('joined', room);
        } else {
            socket.emit('full', room);
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

