# backchanneling-interface

To start, run `npm install` to install dependencies.

Run `docker run -d -p 8888:8888 kurento/kurento-media-server:6.6.0` as well to start a media
server in a docker image. You may need to run `systemctl start docker` beforehand or add `sudo`.

Then, `npm start` starts the server on localhost:3000.
You can use a tool like ngrok to get a publicly facing url ([ngrok tutorial](https://gist.github.com/wosephjeber/aa174fb851dfe87e644e)).                                           
Note: To access clients' mics and cameras, you will need to go to the ngrok site in https.

Once started opening two tabs to whatever address you're using and joining 
the same room on both of them will allow you to test the functionality.

Pressing record will start recording on the server and stop record will stop recording. When the recording is stopped, the recording files are saved to a directory of your choosing on the media server's docker image filesystem and can be transferred to your personal system using `docker cp ...` (I recommend looking up the usage of docker).

You'll notice in `server.js` that you can specify the application server, media server, and recording directory URI's over the command line - or you can simply manually change the defaults.

**Current ToDo**: it's impossible to change the recording file URIs after the first recording, so each recording session overwrites the previous one unless you manually move or save the previous one.

