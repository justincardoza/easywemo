const http = require('http');
const os = require('os');
const udp = require('dgram');
const {URL} = require('url');

const multicastAddress = '239.255.255.250';
const multicastPort = 1900;
const controlURL = '/upnp/control/basicevent1';


var sockets = {};
var devices = {};
var groups = {'all': devices};
var server = http.createServer();

discoverDevices();
setInterval(discoverDevices, 60 * 1000);

server.on('request', handleRequest);
server.listen(4242);



function discoverDevices()
{
	setupInterfaceList();
	sendDiscoveryMessage('urn:Belkin:service:basicevent:1');
}



function handleRequest(request, response)
{
	let pieces = request.url.split('/').filter(x => x);
	
	console.log('Request: ', pieces);
	
	if(pieces.length >= 2)
	{
		group = pieces[0];
		action = pieces[1];
		
		if(action == 'toggle')
		{
			getGroupStates(group, (states) =>
			{
				console.log('States for group ', group, ': ', states);
				let desiredState = !Object.values(states).reduce((a, v) => a &= v);
				
				console.log('Desired state: ', desiredState);
				setGroupState(group, desiredState);
			});
		}
	}
	
	response.end();
}



function setGroupState(group, state, callback)
{
	for(let deviceID in groups[group])
	{
		devices[deviceID].setBinaryState(state, callback);
	}
}



function getGroupStates(group, callback)
{
	let states = {};
	let numCallbacks = Object.keys(groups[group]).length;
	
	for(let deviceID in groups[group])
	{
		devices[deviceID].getBinaryState((deviceState) =>
		{
			states[deviceID] = deviceState;
			numCallbacks--;
			
			if(numCallbacks == 0 && typeof callback == 'function')
				callback(states);
		});
	}
}



//For each network interface, create a multicast-capable socket and add it
//to our list.
function setupInterfaceList()
{
	let interfaces = os.networkInterfaces();
	
	if(interfaces)
	{
		for(let interfaceName in interfaces)
		{
			interfaces[interfaceName].forEach((addressInfo) =>
			{
				if(addressInfo.internal == false && addressInfo.family == 'IPv4' &&
					(!sockets.hasOwnProperty(interfaceName) || sockets[interfaceName].address().address != addressInfo.address))
				{
					let socket = udp.createSocket({type: 'udp4', reuseAddr: true});
					
					socket.on('message', handleDiscoveryResponse);
					socket.on('error', (error) => {console.log('Socket error: ' + error)});
					
					socket.on('listening', () =>
					{
						socket.addMembership(multicastAddress, addressInfo.address);
						socket.setMulticastTTL(128);
					});
					
					//Need to specify both port 0 (so it finds a free one) and the
					//interface address (so it listens on the current device's IP).
					socket.bind(0, addressInfo.address);
					
					if(sockets.hasOwnProperty(interfaceName))
					{
						sockets[interfaceName].close();
						console.log('Updating interface ', interfaceName, ' with address ', addressInfo.address);
					}
					else
					{
						console.log('Adding interface ', interfaceName, ' with address ', addressInfo.address);
					}
					
					sockets[interfaceName] = socket;
				}
			});
		}
	}
	else
	{
		console.log('Error getting network interfaces.');
	}
}


//Send an SSDP discovery message on all available interfaces.
function sendDiscoveryMessage(st)
{
	var msg = 'M-SEARCH * HTTP/1.1\r\nHOST: ' + multicastAddress + ':' + multicastPort + '\r\nST: ' + st + '\r\nMAN: "ssdp:discover"\r\nMX: 3\r\n\r\n';
	
	for(let name in sockets)
	{
		sockets[name].send(msg, multicastPort, multicastAddress, () => {console.log('Discovery message sent using interface ' + name)});
	}
}



function handleDiscoveryResponse(msg, rInfo)
{
	let lines = msg.toString().split('\r\n');
	let obj = {};
	
	console.log('Received response from ' + rInfo.address);
	
	for(let i = 0; i < lines.length; i++)
	{
		let line = lines[i].match(/([\w\-]+)\s*:\s*(.+)/);
		
		if(line)
		{
			obj[line[1]] = line[2].trim();
		}
	}
	
	addDevice(obj);
}



function addDevice(headers)
{
	if(headers['ST'] == 'urn:Belkin:service:basicevent:1' && headers['X-User-Agent'] == 'redsonic')
	{
		let device = {location: headers['LOCATION'], usn: headers['USN']};
		
		device.url = new URL(device.location);
		device.setBinaryState = deviceSetBinaryState;
		device.getBinaryState = deviceGetBinaryState;
		devices[device.usn] = device;
		
		//device.getBinaryState(response => console.log(response));
	}
}



function deviceSetBinaryState(binaryState, callback)
{
	let soap = '<?xml version="1.0" encoding="utf-8"?>' +
		'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
		'<s:Body><u:SetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"><BinaryState>' + (binaryState ? 1 : 0) +
		'</BinaryState></u:SetBinaryState></s:Body></s:Envelope>';
	let postOptions =
	{
		protocol: 'http:',
		hostname: this.url.hostname,
		port: this.url.port,
		method: 'POST',
		path: controlURL,
		headers: {'SOAPACTION': '"urn:Belkin:service:basicevent:1#SetBinaryState"', 'Content-Type': 'text/xml; charset="utf-8"', 'Accept': ''}
	};
	let request = http.request(postOptions, (response) =>
	{
		if(callback && typeof callback == 'function')
		{
			let data = '';
			response.on('data', (chunk) => {data += chunk});
			response.on('end',  () => {callback(data)});
		}
	});
	
	request.on('error', (e) => {console.log('Error with request: ' + e.message)});
	request.write(soap);
	request.end();
}



function deviceGetBinaryState(callback)
{
	let soap = '<?xml version="1.0" encoding="utf-8"?>' +
		'<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
		'<s:Body><u:GetBinaryState xmlns:u="urn:Belkin:service:basicevent:1"></u:GetBinaryState></s:Body></s:Envelope>';
	let postOptions =
	{
		protocol: 'http:',
		hostname: this.url.hostname,
		port: this.url.port,
		method: 'POST',
		path: controlURL,
		headers: {'SOAPACTION': '"urn:Belkin:service:basicevent:1#GetBinaryState"', 'Content-Type': 'text/xml; charset="utf-8"', 'Accept': ''}
	};
	let request = http.request(postOptions, (response) =>
	{
		if(callback && typeof callback == 'function')
		{
			let data = '';
			response.on('data', (chunk) => {data += chunk});
			response.on('end',  () =>
			{
				let result = data.match(/<BinaryState>(\d)<\/BinaryState>/);
				if(result)
					callback(parseInt(result[1]));
			});
		}
	});
	
	request.on('error', (e) => {console.log('Error with request: ' + e.message)});
	request.write(soap);
	request.end();
}
