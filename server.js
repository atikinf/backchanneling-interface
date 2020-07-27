const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
// var kurento = require('kurento-client');
var minimist = require('minimist');



app.use(express.static('public'));
app.use('/scripts', express.static(__dirname + '/node_modules'));

// variables
var kurentoClient = null;

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'http://localhost:3000/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});


// Signaling handlers

io.on('connection', socket => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('a user disconnected');
    });

    socket.on('join', roomNumber => {
        let room = io.sockets.adapter.rooms[roomNumber] || { length: 0 };
        let numClients = room.length;
        console.log(roomNumber, 'has', numClients, 'clients');   
        
        if (numClients == 0) { 
            socket.join(roomNumber);
            socket.emit('created', roomNumber);
        } else if (numClients == 1) {
            socket.join(roomNumber);
            socket.emit('joined', roomNumber);
        } else {
            socket.emit('full', roomNumber);
        }
    });

    // Re-broadcasters
    
    // broadcast by the second participant when they enter the room
    socket.on('ready', room => {
        socket.broadcast.to(room).emit('ready');
    });

    // broadcast an ice candidate to the other client
    socket.on('candidate', event => {
        socket.broadcast.to(event.room).emit('candidate', event);
    });

    // broadcast an offer SDP to the other client
    socket.on('offer', event => {
        socket.broadcast.to(event.room).emit('offer', event);
    });
    
    // Recording stuff, broadcasted to all clients

    socket.on('recording', room => {
        socket.to(room).emit('recording', room);
    });

    socket.on('stop recording', room => {
        socket.to(room).emit('stop recording', room);
    });
});

// Create a media pipeline for a room and emit created
function createRoom(socket, roomNumber, callback) {
    socket.join(roomNumber, () => {
        let myRoom = io.sockets.adapter.rooms[roomNumber];
        getKurentoClient((error, kurento) => {
            kurento.create('MediaPipeline', (err, pipeline) => {
                if (error) {
                    return callback(err);
                }

                myRoom.pipeline = pipeline;
                myRoom.participants = {};
                callback(null, myRoom);
            });
        });
    });
    socket.emit('created', roomNumber);
}

function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

// listener
http.listen(3000, () => {
    console.log('listening on *:3000');
})

