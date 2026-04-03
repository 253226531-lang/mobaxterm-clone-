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
	    groupId?: string;
	    privateKey?: string;
	
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
	        this.groupId = source["groupId"];
	        this.privateKey = source["privateKey"];
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
	export class TunnelConfig {
	    id: string;
	    name: string;
	    type: string;
	    localParam: string;
	    remoteParam: string;
	    host: string;
	    port: number;
	    username: string;
	    password: string;
	    privateKey: string;
	
	    static createFrom(source: any = {}) {
	        return new TunnelConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.localParam = source["localParam"];
	        this.remoteParam = source["remoteParam"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.privateKey = source["privateKey"];
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
	export class DBExpectRule {
	    id: string;
	    sessionId: string;
	    name: string;
	    regexTrigger: string;
	    sendAction: string;
	    isActive: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DBExpectRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.name = source["name"];
	        this.regexTrigger = source["regexTrigger"];
	        this.sendAction = source["sendAction"];
	        this.isActive = source["isActive"];
	    }
	}
	export class DBTunnelConfig {
	    id: string;
	    name: string;
	    type: string;
	    localParam: string;
	    remoteParam: string;
	    targetSessionId: string;
	    isActive: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DBTunnelConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.localParam = source["localParam"];
	        this.remoteParam = source["remoteParam"];
	        this.targetSessionId = source["targetSessionId"];
	        this.isActive = source["isActive"];
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
	export class MacroStep {
	    id: number;
	    macroId: string;
	    command: string;
	    delayMs: number;
	    stepOrder: number;
	
	    static createFrom(source: any = {}) {
	        return new MacroStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.macroId = source["macroId"];
	        this.command = source["command"];
	        this.delayMs = source["delayMs"];
	        this.stepOrder = source["stepOrder"];
	    }
	}
	export class Macro {
	    id: string;
	    name: string;
	    description: string;
	    steps: MacroStep[];
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Macro(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.steps = this.convertValues(source["steps"], MacroStep);
	        this.createdAt = source["createdAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SessionGroup {
	    id: string;
	    parentId: string;
	    name: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parentId = source["parentId"];
	        this.name = source["name"];
	        this.createdAt = source["createdAt"];
	    }
	}

}

