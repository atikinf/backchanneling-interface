const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const kurento = require('kurento-client');


app.use(express.static('public'));
app.use('/scripts', express.static(__dirname + '/node_modules'));

// variables
var kurentoClient = null;
var iceCandidateQueues = {};

// constants
// const argv = minimist(process.argv.slice(2), {
//     default: {
//         as_uri: 'http://localhost:3000/', // app server
//         ws_uri: 'ws://localhost:8888/kurento' // web server
//     }
// });


// Signaling handlers

io.on('connection', socket => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('a user disconnected');
    });

    socket.on('message', function (message) {
        console.log('Message received: ', message.event);
        
        switch (message.event) {
            case 'create or join':
                createOrJoin(socket, message.roomNumber);
                break;
            case 'joinRoom': 
                // 
                break;
            case 'receiveVideoFrom':
                //
                break;
            case 'candidate':
                //
                break;
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

function createOrJoin(socket, roomNumber, callback) {
    getRoom(socket, roomNumber, (err, myRoom) => {
        if (err) {
            return callback(err);
        }

        myRoom.pipeline.create('WebRtcEndpoint', (err, outgoingMedia))
    })
}


function getRoom(socket, roomNumber, callback) {
    let myRoom = io.sockets.adapter.rooms[roomNumber] || { length: 0 };
    let numClients = myRoom.length;

    console.log(roomNumber, ' has ', numClients, ' clients');

    if (numClients == 0) {
        socket.join(roomNumber, () => {
            myRoom = io.sockets.adapter.rooms[roomNumber];
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
    } else if (numClients == 1) {
        socket.join(roomNumber);
        callback(null, myRoom);
    } else {
        socket.emit('full', roomNumber);
        // do not run the callback
    }
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

