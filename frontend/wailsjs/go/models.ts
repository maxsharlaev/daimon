export namespace main {
	
	export class DashboardAlertDTO {
	    id: string;
	    severity: string;
	    title: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new DashboardAlertDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.severity = source["severity"];
	        this.title = source["title"];
	        this.message = source["message"];
	    }
	}
	export class DashboardCPUStatDTO {
	    busyPct: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardCPUStatDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.busyPct = source["busyPct"];
	    }
	}
	export class DashboardDiskDTO {
	    filesystem: string;
	    fsType: string;
	    mount: string;
	    sizeBytes: number;
	    usedBytes: number;
	    availBytes: number;
	    usedPct: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardDiskDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filesystem = source["filesystem"];
	        this.fsType = source["fsType"];
	        this.mount = source["mount"];
	        this.sizeBytes = source["sizeBytes"];
	        this.usedBytes = source["usedBytes"];
	        this.availBytes = source["availBytes"];
	        this.usedPct = source["usedPct"];
	    }
	}
	export class DashboardLoadDTO {
	    load1: number;
	    load5: number;
	    load15: number;
	    cores: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardLoadDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.load1 = source["load1"];
	        this.load5 = source["load5"];
	        this.load15 = source["load15"];
	        this.cores = source["cores"];
	    }
	}
	export class DashboardMemDTO {
	    totalBytes: number;
	    availableBytes: number;
	    availablePct: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardMemDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalBytes = source["totalBytes"];
	        this.availableBytes = source["availableBytes"];
	        this.availablePct = source["availablePct"];
	    }
	}
	export class DashboardNetDevDTO {
	    iface: string;
	    rxBytes: number;
	    txBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardNetDevDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.iface = source["iface"];
	        this.rxBytes = source["rxBytes"];
	        this.txBytes = source["txBytes"];
	    }
	}
	export class DashboardProcessDTO {
	    pid: number;
	    comm: string;
	    cpu: number;
	    mem: number;
	    rssBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new DashboardProcessDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.comm = source["comm"];
	        this.cpu = source["cpu"];
	        this.mem = source["mem"];
	        this.rssBytes = source["rssBytes"];
	    }
	}
	export class DashboardSnapshotDTO {
	    tsUnixMs: number;
	    load: DashboardLoadDTO;
	    cpu: DashboardCPUStatDTO;
	    mem: DashboardMemDTO;
	    disks: DashboardDiskDTO[];
	    topCpu: DashboardProcessDTO[];
	    topMem: DashboardProcessDTO[];
	    netDevices: DashboardNetDevDTO[];
	    alerts: DashboardAlertDTO[];
	
	    static createFrom(source: any = {}) {
	        return new DashboardSnapshotDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tsUnixMs = source["tsUnixMs"];
	        this.load = this.convertValues(source["load"], DashboardLoadDTO);
	        this.cpu = this.convertValues(source["cpu"], DashboardCPUStatDTO);
	        this.mem = this.convertValues(source["mem"], DashboardMemDTO);
	        this.disks = this.convertValues(source["disks"], DashboardDiskDTO);
	        this.topCpu = this.convertValues(source["topCpu"], DashboardProcessDTO);
	        this.topMem = this.convertValues(source["topMem"], DashboardProcessDTO);
	        this.netDevices = this.convertValues(source["netDevices"], DashboardNetDevDTO);
	        this.alerts = this.convertValues(source["alerts"], DashboardAlertDTO);
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
	export class DockerContainerDTO {
	    id: string;
	    name: string;
	    image: string;
	    imageId?: string;
	    state: string;
	    status: string;
	    createdUnix: number;
	    ports?: string;
	
	    static createFrom(source: any = {}) {
	        return new DockerContainerDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.image = source["image"];
	        this.imageId = source["imageId"];
	        this.state = source["state"];
	        this.status = source["status"];
	        this.createdUnix = source["createdUnix"];
	        this.ports = source["ports"];
	    }
	}
	export class DockerDanglingPreviewDTO {
	    count: number;
	    sizeBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new DockerDanglingPreviewDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.count = source["count"];
	        this.sizeBytes = source["sizeBytes"];
	    }
	}
	export class DockerFileEntryDTO {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    mtimeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new DockerFileEntryDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.mtimeMs = source["mtimeMs"];
	    }
	}
	export class DockerImageDTO {
	    id: string;
	    repository: string;
	    tag: string;
	    createdAt?: string;
	    createdSince?: string;
	    size?: string;
	    sizeBytes?: number;
	
	    static createFrom(source: any = {}) {
	        return new DockerImageDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.repository = source["repository"];
	        this.tag = source["tag"];
	        this.createdAt = source["createdAt"];
	        this.createdSince = source["createdSince"];
	        this.size = source["size"];
	        this.sizeBytes = source["sizeBytes"];
	    }
	}
	export class DockerStatusDTO {
	    available: boolean;
	    version?: string;
	    apiVersion?: string;
	    os?: string;
	    arch?: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new DockerStatusDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.version = source["version"];
	        this.apiVersion = source["apiVersion"];
	        this.os = source["os"];
	        this.arch = source["arch"];
	        this.message = source["message"];
	    }
	}
	export class DockerSystemDTO {
	    status: DockerStatusDTO;
	    infoText?: string;
	    diskUsageText?: string;
	
	    static createFrom(source: any = {}) {
	        return new DockerSystemDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = this.convertValues(source["status"], DockerStatusDTO);
	        this.infoText = source["infoText"];
	        this.diskUsageText = source["diskUsageText"];
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
	export class ImportOptions {
	    groupId?: string;
	    passwordStorage: string;
	    keyStorage: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groupId = source["groupId"];
	        this.passwordStorage = source["passwordStorage"];
	        this.keyStorage = source["keyStorage"];
	    }
	}
	export class MacroBindingDTO {
	    id: string;
	    profileId: string;
	    macroId: string;
	    isFavorite: boolean;
	    enabled: boolean;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new MacroBindingDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.profileId = source["profileId"];
	        this.macroId = source["macroId"];
	        this.isFavorite = source["isFavorite"];
	        this.enabled = source["enabled"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class MacroParamDTO {
	    id: string;
	    name: string;
	    prompt: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new MacroParamDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.prompt = source["prompt"];
	        this.order = source["order"];
	    }
	}
	export class MacroDataItemDTO {
	    id: string;
	    key: string;
	    value: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new MacroDataItemDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.key = source["key"];
	        this.value = source["value"];
	        this.order = source["order"];
	    }
	}
	export class MacroDTO {
	    id: string;
	    name: string;
	    tags: string[];
	    script: string;
	    dataItems: MacroDataItemDTO[];
	    params: MacroParamDTO[];
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new MacroDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.tags = source["tags"];
	        this.script = source["script"];
	        this.dataItems = this.convertValues(source["dataItems"], MacroDataItemDTO);
	        this.params = this.convertValues(source["params"], MacroParamDTO);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
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
	
	
	export class PlaceDTO {
	    id: string;
	    profileId: string;
	    name: string;
	    remotePath: string;
	    order: number;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new PlaceDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.profileId = source["profileId"];
	        this.name = source["name"];
	        this.remotePath = source["remotePath"];
	        this.order = source["order"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class ProfileDTO {
	    id: string;
	    groupId: string;
	    name: string;
	    host: string;
	    port: number;
	    username: string;
	    sshOptionsJson: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.groupId = source["groupId"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.sshOptionsJson = source["sshOptionsJson"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class ProfileGroupDTO {
	    id: string;
	    parentId?: string;
	    name: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new ProfileGroupDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parentId = source["parentId"];
	        this.name = source["name"];
	        this.order = source["order"];
	    }
	}
	export class SFTPTransferStartResult {
	    transferId: string;
	    totalBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new SFTPTransferStartResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.transferId = source["transferId"];
	        this.totalBytes = source["totalBytes"];
	    }
	}
	export class SSHConfig {
	    host: string;
	    port: number;
	    username: string;
	    authType: string;
	    password?: string;
	    privateKeyPath?: string;
	    privateKeyPem?: string;
	    passphrase?: string;
	    insecureIgnoreHostKey: boolean;
	    cols?: number;
	    rows?: number;
	    timeoutMs?: number;
	
	    static createFrom(source: any = {}) {
	        return new SSHConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.authType = source["authType"];
	        this.password = source["password"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.privateKeyPem = source["privateKeyPem"];
	        this.passphrase = source["passphrase"];
	        this.insecureIgnoreHostKey = source["insecureIgnoreHostKey"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	        this.timeoutMs = source["timeoutMs"];
	    }
	}
	export class SecretRefDTO {
	    profileId: string;
	    kind: string;
	    storage: string;
	    ref: string;
	    metaJson: string;
	
	    static createFrom(source: any = {}) {
	        return new SecretRefDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.kind = source["kind"];
	        this.storage = source["storage"];
	        this.ref = source["ref"];
	        this.metaJson = source["metaJson"];
	    }
	}
	export class SetSecretRequest {
	    profileId: string;
	    kind: string;
	    storage: string;
	    ref?: string;
	    metaJson?: string;
	    password?: string;
	    privateKeyPem?: string;
	    passphrase?: string;
	
	    static createFrom(source: any = {}) {
	        return new SetSecretRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.kind = source["kind"];
	        this.storage = source["storage"];
	        this.ref = source["ref"];
	        this.metaJson = source["metaJson"];
	        this.password = source["password"];
	        this.privateKeyPem = source["privateKeyPem"];
	        this.passphrase = source["passphrase"];
	    }
	}
	export class UpsertMacroRequest {
	    id?: string;
	    name: string;
	    tags: string[];
	    script: string;
	    dataItems: MacroDataItemDTO[];
	    params: MacroParamDTO[];
	
	    static createFrom(source: any = {}) {
	        return new UpsertMacroRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.tags = source["tags"];
	        this.script = source["script"];
	        this.dataItems = this.convertValues(source["dataItems"], MacroDataItemDTO);
	        this.params = this.convertValues(source["params"], MacroParamDTO);
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
	export class UpsertPlaceRequest {
	    id: string;
	    profileId: string;
	    name: string;
	    remotePath: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new UpsertPlaceRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.profileId = source["profileId"];
	        this.name = source["name"];
	        this.remotePath = source["remotePath"];
	        this.order = source["order"];
	    }
	}
	export class UpsertProfileGroupRequest {
	    id?: string;
	    parentId?: string;
	    name: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new UpsertProfileGroupRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parentId = source["parentId"];
	        this.name = source["name"];
	        this.order = source["order"];
	    }
	}
	export class UpsertProfileRequest {
	    id?: string;
	    groupId: string;
	    name: string;
	    host: string;
	    port: number;
	    username: string;
	    sshOptionsJson: string;
	
	    static createFrom(source: any = {}) {
	        return new UpsertProfileRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.groupId = source["groupId"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.sshOptionsJson = source["sshOptionsJson"];
	    }
	}
	export class VaultStatusDTO {
	    setup: boolean;
	    unlocked: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VaultStatusDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.setup = source["setup"];
	        this.unlocked = source["unlocked"];
	    }
	}

}

export namespace sftp {
	
	export class FileEntryDTO {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    mtimeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new FileEntryDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.mtimeMs = source["mtimeMs"];
	    }
	}
	export class TransferEvent {
	    transferId: string;
	    direction: string;
	    doneBytes: number;
	    totalBytes: number;
	    state: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new TransferEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.transferId = source["transferId"];
	        this.direction = source["direction"];
	        this.doneBytes = source["doneBytes"];
	        this.totalBytes = source["totalBytes"];
	        this.state = source["state"];
	        this.error = source["error"];
	    }
	}

}

