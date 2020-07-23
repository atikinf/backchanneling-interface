const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
// var kurento = require('kurento-client');
// var minimist = require('minimist');



app.use(express.static('public'));
app.use('/scripts', express.static(__dirname + '/node_modules'));

// variables
var kurentoClient = null;
var iceCandidateQueues = {};
var pipelines = {};
var idCounter = 0;


// Signaling handlers

io.on('connection', socket => {
    console.log('a user connected');

    socket.on('disconnect', () => {
        console.log('a user disconnected');
    });

    socket.on('create or join', roomNumber => {
        // handleRoom(socket, roomNumber, (err, room) => {

        // });
        let room = io.sockets.adapter.rooms[roomNumber] || { length: 0 };
        let numClients = room.length;
        console.log(roomNumber, 'has', numClients, 'clients');   
        
        if (numClients == 0) { 
            // joins room and emits 'created'
            socket.join(roomNumber);
            socket.emit('created', roomNumber);
            // createRoom(socket, room, (err, myRoom) => {
            //     // Add a webrtcendpoint to the pipeline
            //     myRoom.pipeline.create('WebRtcEndpoint', (err, outgoingMedia) => {
            //         if (err) {
            //             return console.log(err);
            //         }

            //         var user = {
            //             id: socket.id,
            //             name: 'host',
            //             outgoingMedia: outgoingMedia,
            //             incomingMedia: {},
            //         };

            //         let iceCandidateQueue = iceCandidateQueues[user.id];
            //         if (iceCandidateQueue) {
            //             while (iceCandidateQueue.length) {
            //                 let ice = iceCandidateQueue.shift();
            //                 console.error(`user: ${user.name} collect candidate for outgoing media`);
            //                 user.outgoingMedia.addIceCandidate(ice.candidate);
            //             }
            //         }

            //         user.outgoingMedia.on('OnIceCandidate', event => {
            //             let candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
            //             socket.emit('message', {
            //                 event: 'candidate',
            //                 userid: user.id,
            //                 username: user.name,
            //             });
            //         });

            //         socket.to(roomname).emit('message', {
            //             event: 'newParticipantArrived',
            //             userid: user.id,
            //             username: user.name,
            //         });
            //     });
            // });
        } else if (numClients == 1) {
            socket.join(roomNumber);
            socket.emit('joined', roomNumber);
        } else {
            socket.emit('full', roomNumber);
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

