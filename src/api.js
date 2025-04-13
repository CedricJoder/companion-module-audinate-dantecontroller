const mdns = require('multicast-dns')();
const dgram = require("dgram");
const merge = require("./dante-control/utils/merge");
const { InstanceStatus, Regex } = require('@companion-module/base')

const danteServiceTypes = ["_netaudio-cmc._udp", "_netaudio-dbc._udp", "_netaudio-arc._udp", "_netaudio-chan._udp"];
const danteControlPort = 4440;
const sequenceId1 = Buffer.from([0x29]);
const danteConstant = Buffer.from([0x27]);

function reverse(s) {
    return s.split("").reverse().join("");
}

const getRandomInt = (max) => {
    return Math.floor(Math.random() * max);
};

const intToBuffer = (int) => {
    let intBuffer = Buffer.alloc(2);
    intBuffer.writeUInt16BE(int);
    return intBuffer;
};

const bufferToInt = (buffer) => {
    return buffer.readUInt16BE();
};

const bufferToString = (buffer, index) => {
	let i = index;
	let text = '';
	while (buffer[i] !==0) {
		text += buffer.toString()[i];
		i++;
	}
	return text;
}

const parseString = (string, startIndex) => {
  let text ='';
  for (let i=startIndex; i< string.length; i++) {
    if (string[i] === '\x00') {
      break;
    } else {
      text += string[i];
    }
  }
  return text;
};


const parseChannelCount = (reply) => {
    const channelInfo = { channelCount: { tx: reply[13], rx: reply[15] } };
    return channelInfo;
};

const parseTxChannelNames = (reply) => {
    const names = { channelNames: { tx: [] }, tx:{}, rx:{} };
    const namesString = reply.toString();
    const channelsCount = reply[10];
	  const namesCount = reply[11];

	for (let i = 0; i < namesCount ; i++) {
		const startIndex = 12 + (i * 6);
		const infoBuffer = reply.slice (startIndex, startIndex + 6);
		const nameIndex = parseString(namesString, startIndex);
		//bufferToInt(infoBuffer.slice(0,2));
		//infoBuffer.readUInt16BE(0);
		const nameNumber = bufferToInt(infoBuffer.slice(2,4));
		//infoBuffer.readUInt16BE(2);
		const nameAddress = bufferToInt(infoBuffer.slice(4,6));
		//infoBuffer.readUInt16BE(4);
		const name = bufferToString(reply, nameAddress);
		
		names.channelNames.tx[nameNumber] = name;
		if (names.tx[nameNumber] == undefined) {
		  names.tx[nameNumber]={};
		}
		names.tx[nameNumber].name = name;
	}
    return names;
};


module.exports = {
	
		
	initConnection: function () {
		let self = this;
		
		this.socket = dgram.createSocket({type: "udp4" , reusePort: true});

        this.socket.on("message", this.parseReply.bind(this));
        this.socket.on("error", (error)=>{
			self.updateStatus(InstanceStatus.Disconnected);
			self.log('error', error.message);
		});

        this.socket.on("listening", ()=>{self.updateStatus(InstanceStatus.Ok);}); 
        
        this.socket.bind(danteControlPort);

		this.debug = this.config.verbose;
		
		self.log('debug', 'getting information function');
		self.devicesList = [];
		self.devicesIp = {};
		self.devicesData = {};
		
		self.devicesChoices = [];
		self.destChannelsChoice = {};
		self.sourceChannelsChoice = {};

		self.getInformation();

		self.setupInterval();
		mdns.on('response', self.updateDevices.bind(this));
	},
	
	
	updateChannelChoices: function(deviceIP, ioString) {
	  if (!(this.deviceData[deviceIP] && this.deviceData[deviceIP][ioString])) {
	    this.log('error', "ERROR : Can't update channelsChoices for device " + deviceIP);
	    return;
	  }
	  
	  let deviceName = this.deviceData[deviceIP].name;
	  let ioObject = this.deviceData[deviceIP][ioString];
	  
	  let channelChoice = [{id: 0, label:'None'}];
	  if (ioString == 'tx') {
	    for (let i = 1; i< ioObject.count; i++) {
	      let indexString = i.toString().padStart(2,'0');
	      let channelName = ioObject[i]?.name ?? '';
	    channelChoice.push({id: channelName ?? indexString, label: indexString + ' : ' + channelName});
	    }
	  } else if (ioString == 'rx') {
	    for (let i = 1; i< ioObject.count; i++) {
	      let indexString = i.toString().padStart(2,'0');
	      let channelName = ioObject[i]?.name ?? '';
	      channelChoice.push({id: i, label: indexString + ' : ' + channelName});
	    }
	  }
	  this[ioObject+'ChannelsChoices'][deviceName] = channelChoice;
	}


    parseReply: function(reply, rinfo) {
        const deviceIP = rinfo.address;
        const replySize = rinfo.size;
        const deviceData = {};

        if (this.debug) {
            // Log replies when in debug mode
            this.log('debug', `Rx (${reply.length}): ${reply.toString("hex")}`);
        }

        if (reply[0] === danteConstant[0] && reply[1] === sequenceId1[0]) {
            if (replySize === bufferToInt(reply.slice(2, 4))) {
                const commandId = reply.slice(6, 8);
                deviceData[deviceIP] = {};
                switch (bufferToInt(commandId)) {
                    case 4096:
						let txCount = deviceData[deviceIP]?.channelCount?.tx;
						let rxCount = deviceData[deviceIP]?.channelCount?.rx;
                        deviceData[deviceIP] parseChannelCount(reply);
						
						// update choices;
						if (txCount != deviceData[deviceIP]?.channelCount?.tx) {
							txCount = deviceData[deviceIP]?.channelCount?.tx;
							let sourceChannelChoice = [{id:0, label: 'None'}];
							for (i = 1; i <= txCount; i++) {
								let channel = {id : i.toString().padStart(2,'0'), label : i.toString().padStart(2,'0')};
								sourceChannelChoice.push(channel);
							}
							this.sourceChannelsChoice[this.devicesData[deviceIP].name] = sourceChannelChoice;
						}
						
						// update choices;
						if (rxCount != deviceData[deviceIP]?.channelCount?.rx) {
							rxCount = deviceData[deviceIP]?.channelCount?.rx;
							let destChannelChoice = [];
							for (i = 1; i <= rxCount; i++) {
								let channel = {id : i, label : i.toString().padStart(2,'0')};
								destChannelChoice.push(channel);
							}
							this.destChannelsChoice[this.devicesData[deviceIP].name] = destChannelChoice;
						}
                        break;
                    case 8208:
                        deviceData[deviceIP] = parseTxChannelNames(reply);
						
						let namesArray = deviceData[deviceIP]?.channelNames?.tx;
						for (let i = 1; i < namesArray.length; i++) {
							if (namesArray[i]) {
								this.sourceChannelsChoice[this.devicesData[deviceIP].name][i] = {id: namesArray[i], label: i.toString().padStart(2,'0') + ' : ' + namesArray[i]};
							}
						}
                        break;
                }
				
                this.devicesData = merge(this.devicesData, deviceData);
				if (this.debug) {
                    // Log parsed device information when in debug mode
				    console.log(this.devicesData);
                }
				this.initActions();
				if (this.debug) {
                    // Log parsed device information when in debug mode
				    console.log(this.sourceChannelsChoice);
                }
            }
        }
    },

    sendCommand(command, host, port = danteControlPort) {
        if (this.debug) {
            // Log sent bytes when in debug mode
            this.log('debug', `Tx (${command.length}): ${command.toString("hex")}`);
        }

        this.socket.send(command, 0, command.length, port, host);
    },

    makeCommand(command, commandArguments = Buffer.alloc(2)) {
        let sequenceId2 = Buffer.alloc(2);
        sequenceId2.writeUInt16BE(getRandomInt(65535));

        const padding = Buffer.from([0x00, 0x00]);
        let commandLength = Buffer.alloc(2);
        let commandId = Buffer.alloc(2);

        switch (command) {
            case "channelCount":
                commandId = Buffer.from("1000", "hex");
                break;
            case "deviceInfo":
                commandId = Buffer.from("1003", "hex");
                break;
            case "deviceName":
                commandId = Buffer.from("1002", "hex");
                break;
            case "subscription":
                commandId = Buffer.from("3010", "hex");
                break;
            case "rxChannelNames":
                commandId = Buffer.from("3000", "hex");
                break;
            case "txChannelNames":
                commandId = Buffer.from("2010", "hex");
                break;
            case "setRxChannelName":
                commandId = Buffer.from([0x30, 0x01]);
                break;
            case "setTxChannelName":
                commandId = Buffer.from([0x20, 0x13]);
                break;
            case "setDeviceName":
                commandId = Buffer.from([0x10, 0x01]);
                break;
        }

        commandLength.writeUInt16BE(
            Buffer.concat([
                danteConstant,
                sequenceId1,
                sequenceId2,
                commandId,
                Buffer.alloc(2),
                commandArguments,
                Buffer.alloc(1),
            ]).length + 2
        );

        return Buffer.concat([
            danteConstant,
            sequenceId1,
            commandLength,
            sequenceId2,
            commandId,
            Buffer.alloc(2),
            commandArguments,
            Buffer.alloc(1),
        ]);
    },

    resetDeviceName(ipaddress) {
        const commandBuffer = this.makeCommand("setDeviceName");
        this.sendCommand(commandBuffer, ipaddress);
    },

    setDeviceName(ipaddress, name) {
        const commandBuffer = this.makeCommand("setDeviceName", Buffer.from(name, "ascii"));
        this.sendCommand(commandBuffer, ipaddress);
    },

    setChannelName(ipaddress, channelName = "", channelType = "rx", channelNumber = 0) {
        const channelNameBuffer = Buffer.from(channelName, "ascii");
        let commandBuffer = Buffer.alloc(1);
        let channelNumberBuffer = Buffer.alloc(2);
        channelNumberBuffer.writeUInt16BE(channelNumber);

        if (channelType === "rx") {
            const commandArguments = Buffer.concat([
                Buffer.from("0401", "hex"),
                channelNumberBuffer,
                Buffer.from("001c", "hex"),
                Buffer.alloc(12),
                channelNameBuffer,
            ]);
            commandBuffer = this.makeCommand("setRxChannelName", commandArguments);
        } else if (channelType === "tx") {
            const commandArguments = Buffer.concat([
                Buffer.from("040100000", "hex"),
                channelNumberBuffer,
                Buffer.from("0024", "hex"),
                Buffer.alloc(18),
                channelNameBuffer,
            ]);
            commandBuffer = this.makeCommand("setTxChannelName", commandArguments);
        } else {
            throw "Invalid Channel Type - must be 'tx' or 'rx'";
        }
        this.sendCommand(commandBuffer, ipaddress);
    },

    resetChannelName(ipaddress, channelType = "rx", channelNumber = 0) {
        this.setChannelName(ipaddress, "", channelType, channelNumber);
    },

    makeCrosspoint(ipaddress, sourceChannelName, sourceDeviceName, destinationChannelNumber = 0) {
        const sourceChannelNameBuffer = Buffer.from(sourceChannelName, "ascii");
        const sourceDeviceNameBuffer = Buffer.from(sourceDeviceName, "ascii");

        const commandArguments = Buffer.concat([
            Buffer.from("0401", "hex"),
            intToBuffer(destinationChannelNumber),
            Buffer.from("005c006d", "hex"),
            Buffer.alloc(107 - sourceChannelNameBuffer.length - sourceDeviceNameBuffer.length),
            sourceChannelNameBuffer,
            Buffer.alloc(1),
            sourceDeviceNameBuffer,
        ]);

        const commandBuffer = this.makeCommand("subscription", commandArguments);

        this.sendCommand(commandBuffer, ipaddress);
    },

    clearCrosspoint(ipaddress, destinationChannelNumber) {
        const commandArguments = Buffer.concat([
            Buffer.from("0401", "hex"),
            intToBuffer(destinationChannelNumber),
            Buffer.from("005c006d", "hex"),
            Buffer.alloc(108),
        ]);

        const commandBuffer = this.makeCommand("subscription", commandArguments);

        this.sendCommand(commandBuffer, ipaddress);
    },

    getChannelCount(ipaddress) {
        const commandBuffer = this.makeCommand("channelCount");
        this.sendCommand(commandBuffer, ipaddress);

        return this.devicesData[ipaddress]?.channelCount;
    },

    getChannelNames(ipaddress) {
        const commandBuffer = this.makeCommand("txChannelNames", Buffer.from("0001000100", "hex"));
        this.sendCommand(commandBuffer, ipaddress);

        return this.devicesData[ipaddress]?.channelNames;
    },

    get devices() {
        return this.devicesList;
    },

	

	updateDevices: function(response){
		response?.answers?.forEach((answer) => {
			if (answer.name?.match(/_netaudio-arc._udp/)) {
				let name = answer.data?.toString().slice(0, -25);
	

				if (name && (!this.devicesList.includes(name))) {
					this.devicesList.push(name);
					this.log('info', 'Adding device : ' + name);
					
					response.additionals.forEach((additional) => {
						if (additional.type == 'A') {
							this.devicesIp[name] = additional.data;
							let deviceData = {}
							deviceData[additional.data] = {name: name};
							merge (this.devicesData, deviceData); 
						}
					});
					
					
					// get channels info from devices
					let ip = this.devicesIp[name] ?? name+'.local'
					this.getChannelCount(ip);
					/*
					let sourceChannels={
					let sourceChannels = [];
					for (let i = 0; i < 
					sourceChannelsChoice
	*/
					
					
					
					this.getChannelNames(ip);
					
					// updates actions choices
					let deviceChoice = { 'id' : name, 'label' : name};
					this.devicesChoices.push(deviceChoice);
					
				}
			}
		});
		this.initActions();
	},
	
	
	setupInterval: function() {
		let self = this;
	
		self.stopInterval();
	
		if (self.config.interval > 0) {
			self.INTERVAL = setInterval(self.getInformation.bind(self), self.config.interval);
			self.log('info', 'Starting Update Interval: Every ' + self.config.interval + 'ms');
		}
	},
	
	stopInterval: function() {
		let self = this;
	
		if (self.INTERVAL !== null) {
			self.log('info', 'Stopping Update Interval.');
			clearInterval(self.INTERVAL);
			self.INTERVAL = null;
		}
	},
	
	getInformation: async function () {
		//Get all information from Device
		let self = this;

		self.log('debug', 'getting info');
		
		mdns.query({
			questions:[{
				name:'_netaudio-arc._udp.local',
				type:'PTR'
			}]
		});


		self.checkVariables();
	},
	
	updateData: function (bytes) {
		let self = this;
	
		//do more stuff
	
		self.checkFeedbacks();
		self.checkVariables();
	},
}
