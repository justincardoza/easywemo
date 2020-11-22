const http = require('http');
const os = require('os');
const fs = require('fs');
const udp = require('dgram');
const {URL} = require('url');

const multicastAddress = '239.255.255.250';
const multicastPort = 1900;
const controlURL = '/upnp/control/basicevent1';


var sockets = {};
var devices = {};
var groups = {'all': {}};
var server = http.createServer();

try
{
	Object.assign(groups, JSON.parse(fs.readFileSync('groups.json')));
}
catch(error)
{
	console.log('Unable to load Wemo groups from file: ' + error);
}

discoverDevices();
setInterval(discoverDevices, 10 * 1000);

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
		let action = pieces[0];
		let group = pieces[1];
		
		if(action == 'toggle')
		{
			if(group in groups)
			{
				getGroupStates(group, (states) =>
				{
					console.log('States for group ', group, ': ', states);
					let desiredState = !Object.values(states).reduce((a, v) => a &= v);
					
					console.log('Desired state: ', desiredState);
					setGroupState(group, desiredState);
				});
			}
			else if(group in devices)
			{
				devices[group].getBinaryState(currentState => devices[group].setBinaryState(!currentState));
			}
			else
			{
				console.log(`Don't know how to toggle ${group}.`);
			}
		}
		else if(action == 'addtogroup' && pieces.length >= 3)
		{
			let usn = pieces[2];
			
			if(group == 'all')
			{
				console.log("Can't add devices to 'all' group.");
				response.writeHead(400);
			}
			else if(!(usn in devices))
			{
				console.log(`Unknown device: ${usn}`);
				response.writeHead(404);
			}
			else
			{
				if(!(group in groups) || !groups[group])
					groups[group] = {};
				
				groups[group][usn] = 1;
				saveGroups();
				console.log(`Added device ${usn} to group ${group}.`);
			}
		}
		else if(action == 'removefromgroup' && pieces.length >= 3)
		{
			let usn = pieces[2];
			
			if(group == 'all')
			{
				console.log("Can't remove devices from 'all' group.");
				response.writeHead(400);
			}
			else if(!(usn in devices))
			{
				console.log(`Unknown device: ${usn}`);
				response.writeHead(404);
			}
			else if(group in groups && groups[group] && usn in groups[group])
			{
				delete groups[group][usn];
				
				if(Object.keys(groups[group]).length == 0)
					delete groups[group];
				
				saveGroups();
				console.log(`Removed device ${usn} from group ${group}.`);
			}
		}
	}
	else if(pieces.length >= 1)
	{
		let action = pieces[0];
		
		response.setHeader('Content-Type', 'application/json');
		
		if(action == 'getdevices')
		{
			response.writeHead(200);
			response.write(JSON.stringify(devices));
		}
		else if(action == 'getgroups')
		{
			response.writeHead(200);
			response.write(JSON.stringify(groups));
		}
		else if(action == 'getstatus')
		{
			//Respond with status for all devices?
		}
		else
		{
			response.writeHead(404);
		}
	}
	else
	{
		response.setHeader('Content-Type', 'text/html');
		response.writeHead(200);
		response.write(fs.readFileSync('webclient.html'));
	}
	
	response.end();
}



function setGroupState(group, state, callback)
{
	console.log(`Setting state to ${state} for group ${group}.`);
	
	for(let deviceID in groups[group])
	{
		if(deviceID in devices)
		{
			devices[deviceID].setBinaryState(state, callback);
			console.log(`Setting state to ${state} for device ${deviceID}.`);
		}
		else
		{
			console.log(`Not setting state for unknown device ${deviceID}.`);
		}
	}
}



function getGroupStates(group, callback)
{
	let states = {};
	let numCallbacks = Object.keys(groups[group]).length;
	
	for(let deviceID in groups[group])
	{
		if(deviceID in devices && 'getBinaryState' in devices[deviceID])
		{
			devices[deviceID].getBinaryState((deviceState) =>
			{
				states[deviceID] = deviceState;
				numCallbacks--;
			
				if(numCallbacks == 0 && typeof callback == 'function')
					callback(states);
			});
		}
		else
		{
			console.log(`Not getting state for unknown device ${deviceID}.`);
			numCallbacks--;
		}
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
		sockets[name].send(msg, multicastPort, multicastAddress, () => console.log('Discovery message sent using interface ' + name));
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
	if((headers['ST'] == 'urn:Belkin:service:basicevent:1' || headers['ST'] == 'upnp:rootdevice') && headers['X-User-Agent'] == 'redsonic')
	{
		let device = {location: headers['LOCATION'], usn: headers['USN']};
		
		device.url = new URL(device.location);
		device.setBinaryState = deviceSetBinaryState;
		device.getBinaryState = deviceGetBinaryState;
		devices[device.usn] = device;
		
		groups.all[device.usn] = 1;
		
		fetchDeviceInfo(device.usn);
	}
}



function removeDevice(usn)
{
	if(usn in devices)
		delete devices[usn];
	
	for(let group in groups)
	{
		if(usn in groups[group])
			delete groups[group][usn];
	}
}



function saveGroups()
{
	try
	{
		fs.writeFileSync('groups.json', JSON.stringify(groups));
	}
	catch(error)
	{
		console.log('Unable to save group data: ' + error);
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
		headers: {
			'SOAPACTION': '"urn:Belkin:service:basicevent:1#SetBinaryState"', 
			'Content-Type': 'text/xml; charset="utf-8"', 
			'Accept': '',
			'Content-Length': soap.length,
		}
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
	
	request.on('error', (e) => {console.log('Error with request: ' + JSON.stringify(e))});
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
		headers: {
			'SOAPACTION': '"urn:Belkin:service:basicevent:1#GetBinaryState"', 
			'Content-Type': 'text/xml; charset="utf-8"', 
			'Accept': '',
			'Content-Length': soap.length,
		}
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
	
	request.on('error', (e) => { console.log('Error with request: ', e)});
	request.write(soap);
	request.end();
}



function fetchDeviceInfo(usn)
{
	if(usn in devices)
	{
		let request = http.get(devices[usn].location, response =>
		{
			let data = '';
			let infoFieldNames = ['friendlyName', 'manufacturer', 'modelDescription', 'modelName', 'modelNumber', 'hwVersion', 'modelURL', 'serialNumber', 'UDN', 'UPC', 'macAddress', 'hkSetupCode', 'firmwareVersion'];
			
			response.on('error', error => console.log('Error fetching data for device ' + usn + ': ' + error));
			response.on('data', chunk => data += chunk);
			
			response.on('end', () =>
			{
				for(let fieldName of infoFieldNames)
				{
					let pattern = new RegExp(`<${fieldName}>([^<]*)</${fieldName}>`);
					let result = pattern.exec(data);
					
					if(result && result.length && result.length > 1)
					{
						devices[usn][fieldName] = result[1];
					}
				}
			});
		});
	}
}
