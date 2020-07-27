// TODO: rtcPeerConnection.addStream() is deprecated

// Based in part on https://webrtc.ventures/2018/07/tutorial-build-video-conference-application-webrtc-2/

// DOM elements
const joinRoomButton = document.getElementById('join-room-button');
const roomNumberInput = document.getElementById('room-number-input');
const localVideo  = document.getElementById('your-video');
const remoteVideo = document.getElementById('friends-video');
const startRecording = document.getElementById('btn-start-recording');
const stopRecording = document.getElementById('btn-stop-recording');
const downloadRecording = document.getElementById('btn-download-recording');
const overlayContainer = document.getElementById('overlay-container');
const progressBar = document.getElementById('progress-bar');

const recordingBlockElements = document.getElementsByClassName('recording-block');
const downloadBlockElements = document.getElementsByClassName('download-block');

// Global vars

var roomNumber;
var localStream;
var remoteStream;
var rtcPeerConnection;

var localRec;
var remoteRec;
var dateStarted;

var isCaller;


// Constants

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

// When server emits created, a pipeline has been created for the room
// and our socket has joined that room
socket.on('created', (room) => {
    console.log('Got created signal for room', room, 'setting up stream');

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
        console.log('sending an offer:', offer);
        socket.emit('offer', {
            type: 'offer',
            sdp: offer,
            room: roomNumber,
        });
    }
});

// When server emits joined
socket.on('joined', (room) => {
    console.log('Got joined signal for room', room,);

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
        console.log('sending an offer:', offer);
        socket.emit('offer', {
            type: 'offer',
            sdp: offer,
            room: roomNumber,
        });

        socket.emit('ready');
    }
});

// There are two clients in a room
socket.on('ready', () => {
    setupRecordInterface();
});

// When server emits offer, match the caller's connection with remote's own
socket.on('offer', event => {
    console.log('Got SDP:', event.sdp);
    rtcPeerConnection.processAnswer(event.sdp);
});

// When a client emits a candidate the server sends it through
socket.on('candidate', event => {
    rtcPeerConnection.addIceCandidate(event.candidate);
});

// When server emits full
socket.on('full', room => {
    alert('Room ' + roomNumber + ' is full, please join a different room.');
})

// When server emits recording
socket.on('recording', room => {
    overlayContainer.style.display = "none";
    alert('The host has started recording this session.');
});

// When server emits stop recording
socket.on('stop recording', room => {
    overlayContainer.style.display = "block";
    alert('The host has stopped recording this session.');
});

// Callbacks and helpers

function onIceCandidate(candidate, wp) {
    console.log('sending ice candidates');
    socket.emit('candidate', {
        type: 'candidate',
        candidate: candidate,
        room: roomNumber,
    });
}


function setupRecordInterface() {
    Array.from(recordingBlockElements).forEach(element => {
        element.classList.add("show");
    });

    startRecording.addEventListener('click', () => {
        startRecording.disabled = true;
        overlayContainer.style.display = "none";
        
        socket.emit('recording', roomNumber);
        Array.from(downloadBlockElements).forEach(element => {
            element.classList.remove("show");
            downloadRecording.classList.add('disabled');
        })

        // One recorder for each video feed
        localRec = RecordRTC(localStream, recordingOptions)

        remoteRec = RecordRTC(remoteStream, recordingOptions);

        localRec.startRecording();
        remoteRec.startRecording();

        dateStarted = new Date().getTime();
        console.log("Started Recording");

        stopRecording.disabled = false;

        (function looper() {
            if(!localRec) {
                return;
            }
            stopRecording.innerHTML = 'Stop Recording (' + calculateTimeDuration((new Date().getTime() - dateStarted) / 1000) + ')';

            setTimeout(looper, 1000);
        })();
    });
    
    stopRecording.addEventListener('click', () => {
        const zip = new JSZip();

        // Zip the videos as two webms
        let blobs = async.parallel([
            function(callback) {
                localRec.stopRecording(() => {
                    callback(null, localRec.getBlob());
                    localRec = null;
                });
            },
            function(callback) {
                remoteRec.stopRecording(() => {
                    callback(null, remoteRec.getBlob());
                    remoteRec = null;
                });
            }
        ], 
        function(err, result) {
            console.log("Zipping recordings...");
            zip.folder("recordings").file("yourVideo.webm", result[0]);
            zip.folder("recordings").file("theirVideo.webm", result[1]);
            
            console.log("Generating zip...");
            zipFile = zip.generateAsync({type: "blob"}, (metadata) => {
                progressBar.style.width = metadata.percent + '%';
                progressBar.innerHTML = metadata.percent.toFixed(1) + '%';
            })
            .then((file) => {
                console.log("Generated : ) ready to download");
                downloadRecording.href = URL.createObjectURL(file);
                downloadRecording.download = 'recordings.zip';
                downloadRecording.classList.remove('disabled');
            })
            
        });

        // Update recording interface
        startRecording.disabled = false;
        stopRecording.disabled = true;
        stopRecording.innerHTML = 'Stop Recording';
        
        Array.from(downloadBlockElements).forEach(element => {
            element.classList.add("show");
        })
        // downloadRecording.style.display = "block";

        socket.emit('stop recording', roomNumber);
    });
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