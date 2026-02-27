export namespace config {
	
	export class Config {
	    id: string;
	    name: string;
	    protocol: string;
	    host: string;
	    port: number;
	    username?: string;
	    password?: string;
	    baudRate?: number;
	    dataBits?: number;
	    stopBits?: string;
	    parity?: string;
	    flowControl?: string;
	    comPort?: string;
	    description?: string;
	    encoding?: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.baudRate = source["baudRate"];
	        this.dataBits = source["dataBits"];
	        this.stopBits = source["stopBits"];
	        this.parity = source["parity"];
	        this.flowControl = source["flowControl"];
	        this.comPort = source["comPort"];
	        this.description = source["description"];
	        this.encoding = source["encoding"];
	    }
	}

}

export namespace connection {
	
	export class FileInfo {
	    name: string;
	    size: number;
	    mode: string;
	    modTime: string;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.modTime = source["modTime"];
	        this.isDir = source["isDir"];
	    }
	}

}

export namespace db {
	
	export class CommandLog {
	    id: number;
	    sessionId: string;
	    sessionName: string;
	    host: string;
	    protocol: string;
	    command: string;
	    timestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new CommandLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.sessionName = source["sessionName"];
	        this.host = source["host"];
	        this.protocol = source["protocol"];
	        this.command = source["command"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class KnowledgeEntry {
	    id: number;
	    title: string;
	    deviceType: string;
	    commands: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new KnowledgeEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.deviceType = source["deviceType"];
	        this.commands = source["commands"];
	        this.description = source["description"];
	    }
	}

}

