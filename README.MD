# Share the Video

Watch movies and videos with friends, perfectly in sync. Everyone can play, pause and skip, and the whole room follows. The video streams straight from your own PC, with no third-party server in between.

## Features

- Original quality: your file plays as it is, with no re-encoding and no resolution cap
- Everyone has control: if anyone plays, pauses or skips 10 seconds, it syncs for everybody
- No third-party server: nothing depends on someone else's uptime
- Live chat with activity events (who joined, left, paused, played or skipped)
- Built-in voice chat with microphone and headphone selection
- Subtitle support
- Works on PC and mobile

## Requirements

- [Node.js](https://nodejs.org) (v18 or newer recommended)
- A video file on the host PC (MP4 recommended)
- Optional: a subtitle file
- Optional: [Tailscale](https://tailscale.com) if you don't have a public IP

## Install

```bash
git clone https://github.com/Tanvir-Sorforaz/video-streaming.git
cd video-streaming
npm install
```

## Run the server

```bash
npm start
```

The terminal will ask you to pick a video, then ask if you want to add a subtitle file. After that, the server starts on port **6996** and prints the links you can share.

## Share the video

Pick one of the options below. Voice chat only works with the **HTTPS** link (see Option 3), because browsers block the microphone on plain HTTP.

### Option 1: Public IP

If you have a real public IP address and your router forwards port 6996 to your PC, share this link:

```text
http://YOUR_PUBLIC_IP:6996
```

To find your public IP, search **"what is my IP"** on Google. If friends can't connect, your internet provider may be sharing one IP between many customers, so use Tailscale instead.

Video and chat work. Voice chat does not, because there is no HTTPS.

### Option 2: Tailscale (no public IP needed)

1. Install Tailscale on your PC and on every friend's device.
2. Let your friends reach your PC, in one of two ways:
   - **Recommended:** in the Tailscale admin console, open **Machines**, click the menu next to your PC, choose **Share**, and send them the invite link. They sign in with their own account and accept it.
   - Or invite them to your tailnet from the **Users** page.
3. Find your Tailscale IP from the Tailscale icon in the system tray.
4. Share this link:

```text
http://YOUR_TAILSCALE_IP:6996
```

Video and chat work. Voice chat does not, because there is no HTTPS.

### Option 3: Tailscale with HTTPS (voice chat works)

1. In the Tailscale admin console, open the **DNS** page. Make sure **MagicDNS** is on, then click **Enable HTTPS**.
2. Start the app with `npm start`. your will see the links in the terminal.

3. if not then, In another terminal, run:

```bash
tailscale serve --bg 6996
```
 Check your link with:

```bash
tailscale serve status
```
 Share the `https://` link it shows:

```text
https://YOUR-PC-NAME.YOUR-TAILNET.ts.net
```

Use this link exactly as shown, with `https://` and **no port number**. The video still streams from your PC to your friends over Tailscale's encrypted connection. It does not go through Tailscale's servers, except in rare cases when a direct connection is not possible.

To stop sharing later:

```bash
tailscale serve reset
```

## Voice chat

- Open the HTTPS link, click the microphone in the chat panel, and allow microphone access.
- Voice is peer-to-peer between friends, so it works best for small groups (up to about 8 people).
- Use headphones to avoid echo from the movie audio.
- Choose your microphone and speakers from the settings (gear) button. Speaker selection works in Chrome and Edge only.
- Bluetooth headsets switch to low-quality audio when their microphone is used. For the best sound, keep them for listening and use another microphone.

## Tips

- Your upload speed decides how many friends can watch in good quality. A 1080p movie needs roughly 5 to 8 Mbps per viewer.
- If the link doesn't open, make sure the server is running, and that Tailscale is running on both devices.
- If the chat or voice buttons don't appear after an update, do a hard refresh (Ctrl + Shift + R).

## Built with

Node.js, Express, Socket.IO and WebRTC