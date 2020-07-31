// Based in part on https://webrtc.ventures/2018/07/tutorial-build-video-conference-application-webrtc-2/
// as well as a lot of kurento-utils tutorials

// DOM elements
const joinRoomButton = document.getElementById('join-room-button');
const roomNumberInput = document.getElementById('room-number-input');
const localVideo  = document.getElementById('your-video');
const remoteVideo = document.getElementById('friends-video');
const startRecording = document.getElementById('btn-start-recording');
const stopRecording = document.getElementById('btn-stop-recording');
// const downloadRecording = document.getElementById('btn-download-recording');
const overlayContainer = document.getElementById('overlay-container');
// const progressBar = document.getElementById('progress-bar');

const recordingBlockElements = document.getElementsByClassName('recording-block');
// const downloadBlockElements = document.getElementsByClassName('download-block');

// Updated when room list is sorted
var roomList = document.getElementById('room-list');

// Global vars

var userid;
var roomNumber;
var rtcPeerConnection;
var recording; // a boolean
var dateStarted; // start of recording

var roomCounts = {}; // corresponds to room-counts list in DOM

// Constants

const maxClients = 2;

const streamConstraints = { 
    audio: true, 
    video: { 
        width: 960, 
        height: 720, 
        framerate: {
            ideal: 25,
            max: 30,
        },
    },
};
// Used with RecordRTC
const recordingOptions = { 
    type: 'video',
    video: {
        width: 960,
        height: 720,
    },
    framerate: {
        exact: 20,
    },
};

// Connect to socket.io server
var socket = io()

joinRoomButton.addEventListener('click', () => {
    if (!roomNumberInput.value || roomNumberInput.value === '') {
        roomNumber = 1;
    } else {
        roomNumber = roomNumberInput.value;
    }
    overlayContainer.style.display = "block";
    
    socket.emit('join', roomNumber);
});

// When server emits joined, i.e. a user has joined the room
socket.on('joined', (event) => {

    console.log('Joined room', event.room, 'with', 
        event.numClients, 'clients');

    userid = event.userid;

    // Specifications for a Kurento WebRTCPeer
    const options = {
        localVideo: localVideo,
        remoteVideo: remoteVideo,
        onicecandidate : onIceCandidate,
        mediaConstraints: streamConstraints
    };

    // Create a connection to send/receive video 
    rtcPeerConnection = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, 
        function (err) {
            if (err) {
                return console.error(err);
            }
            this.generateOffer(onOffer);
        }
    );

    var onOffer = function(err, offer, wp) {
        console.log('sending an offer');
        socket.emit('offer', {
            type: 'offer',
            room: event.room,
            userid: userid,
            sdpOffer: offer,
        });
    }
});

// There are two clients in a room, so set up the recording interface
// for the first of them to arrive
socket.on('ready', () => {
    setupRecordInterface();
});

// When the server emits an SDP response, process it locally
socket.on('answer', event => {
    console.log('Got SDP answer, processing locally...');
    rtcPeerConnection.processAnswer(event.sdpOffer);
});

// When the server emits an ICE candidate, process it locally
socket.on('candidate', event => {
    console.log('Got candidate, adding locally...')
    rtcPeerConnection.addIceCandidate(event.candidate);
});

// When server emits full
socket.on('full', room => {
    alert('Room ' + room + ' is full, please join a different room.');
})

socket.on('room count', event =>  {
    Object.keys(event.counts).forEach((room) => {
        updateListEntry(room, event.counts[room]);
    });
    // updateListEntry(event.room, event.count);
});

// Recording Stuff

// When the server successfully starts recording
socket.on('recording started', () => {
    overlayContainer.style.display = "none";
    alert('The host has started recording this session.');
});

// When the server stops recording
socket.on('recording stopped', () => {
    overlayContainer.style.display = "block";
    alert('The host has stopped recording this session.');
});

// When the recordings are written to the media server disk
socket.on('recording finished', () => {
    alert('Recording(s) written to media server disk');
});

socket.on('recording error', () => {
    alert('Error: Couldn\'t start recording');
})

// Callbacks and helpers

function onIceCandidate(candidate, wp) {
    console.log('sending ice candidates');
    socket.emit('candidate', {
        type: 'candidate',
        room: roomNumber,
        userid: userid,
        candidate: candidate,
    });
}


function setupRecordInterface() {
    Array.from(recordingBlockElements).forEach(element => {
        element.classList.add("show");
    });

    startRecording.addEventListener('click', () => {
        startRecording.disabled = true;
        overlayContainer.style.display = "none";
        
        socket.emit('start recording', {
            room: roomNumber,
            userid: userid,
        });

        recording = true;

        dateStarted = new Date().getTime();
        console.log("Started Recording");

        stopRecording.disabled = false;

        (function looper() {
            if(!recording) {
                return;
            }
            stopRecording.innerHTML = 'Stop Recording (' + calculateTimeDuration((new Date().getTime() - dateStarted) / 1000) + ')';

            setTimeout(looper, 1000);
        })();
    });
    
    stopRecording.addEventListener('click', () => {
        recording = false;

        socket.emit('stop recording', {
            room: roomNumber,
            userid: userid,
        });

        // Update recording interface
        startRecording.disabled = false;
        stopRecording.disabled = true;
        stopRecording.innerHTML = 'Stop Recording';
    });
}

function updateListEntry(room, count) {
    // If count is zero, then we need to remove the corresponding room list item
    console.log('room, count');
    console.log(room, count);

    let child = document.getElementById('room-' + room);
    if (child) {
        roomList.removeChild(child);
    }

    if (count > 0) {
        let child = document.createElement('li');
        child.textContent = 'Room ' + room;
        child.id = 'room-' + room;
        child.className = 'list-group-item d-flex justify-content-between align-items-center';
        let childSpan = document.createElement('span');
        childSpan.className = 'badge badge-primary badge-pill';
        childSpan.textContent = count;
        child.appendChild(childSpan);
        roomList.appendChild(child);

        sortList(roomList);
    }
}

// html ul element sorting function from stack overflow
function sortList(ul){
    var new_ul = ul.cloneNode(false);

    // Add all lis to an array
    var lis = [];
    for(var i = ul.childNodes.length; i--;){
        if(ul.childNodes[i].nodeName === 'LI')
            lis.push(ul.childNodes[i]);
    }

    // Sort the lis in descending order
    lis.sort(function(a, b){
       return parseInt(b.childNodes[0].data , 10) - 
              parseInt(a.childNodes[0].data , 10);
    });

    // Add them into the ul in order
    for(var i = 0; i < lis.length; i++)
        new_ul.appendChild(lis[i]);
    ul.parentNode.replaceChild(new_ul, ul);
    roomList = new_ul;
}


// From recordRTC duration demo
function calculateTimeDuration(secs) {
    var hr = Math.floor(secs / 3600);
    var min = Math.floor((secs - (hr * 3600)) / 60);
    var sec = Math.floor(secs - (hr * 3600) - (min * 60));

    if (min < 10) {
        min = "0" + min;
    }

    if (sec < 10) {
        sec = "0" + sec;
    }

    if(hr <= 0) {
        return min + ':' + sec;
    }

    return hr + ':' + min + ':' + sec;
}