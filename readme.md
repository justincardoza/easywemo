# EasyWemo (deprecated)

**Note**: I'm actually starting to switch over to [Home Assistant](https://www.home-assistant.io/) 
for my smart home stuff. It seamlessly detects our wemos, does a bunch of other stuff 
really well, integrates it all into one single locally-hosted web dashboard (plus an app), 
and still runs on a Raspberry Pi. I highly recommend it. This project is still neat, but 
in terms of sheer functionality and features, it might be time to look elsewhere.

My first smart home devices were a couple of Wemo Mini smart plugs. I used them
to control the lamps in the living room of my first apartment. However, I was
very quickly frustrated with Belkin's Wemo app, and I was pretty sure I could
come up with something faster and more flexible. This is the first major
program I made that fits that description. It keeps track of all Wemo devices
on the current LAN, and allows local clients to quickly turn them on and off
in groups.

## How to Use

You will need Node.js installed on whatever computer you decide to run this
server program on. I use a Raspberry Pi 2 that I had laying around, since this
doesn't require much CPU power or network bandwidth. Run the main script with
`node index.js` or use a startup shortcut to start it automatically. If you're
using Raspbian like me, you can drop `EasyWemo.desktop` into your
`~/.config/autostart` folder, and if you cloned the project into
`/home/pi/easywemo`, it will work completely as-is.

Now you can send HTTP requests to that computer on port 4242 to turn your lights
on and off quickly. The request is encoded entirely in the request path, so to 
turn all of your Wemos on or off simultaneously
(that's all I really do with it on a day-to-day basis), send a request to
`/all/toggle`. So for example, if your server is at address `192.168.0.101`,
requesting `http://192.168.0.101:4242/all/toggle` will toggle all the Wemos
at once.

I like to use an automation app to create a widget on my phone which will make
that request with a single tap. I use
[Automate](https://play.google.com/store/apps/details?id=com.llamalab.automate&hl=en)
on my Android phone; on an iPhone, [Workflow](http://www.workflow.is/) is a
great choice. Of course, in a pinch, you can always just type or paste it into
a web browser.

## Wish List

There's so much I'd like to improve in this code. However, right now I'm
designing a more general networked software service framework that I plan to
eventually rewrite this under. Some of the things I plan to do with it are:

* More flexible/RESTful requests
* Group management
* Administration interface
* An interface at all beyond a borderline API
* Support for more actions
* Scheduling and automation
* Support for other smart plugs/bulbs
* UPnP subscriptions so it doesn't have to fetch device states
* Handle UPnP broadcasts from devices

## Miscellaneous

The code will search for new devices every minute. Also, every time it sends a
discovery message, it re-enumerates the network interfaces in case an interface
has become active since the last broadcast. I had to add that because
if the server boots up before the router (mine did) and the program runs at
startup (also true on my network), it will be assigned a [link-local address](https://en.wikipedia.org/wiki/Link-local_address),
which doesn't let it communicate with anything else.
