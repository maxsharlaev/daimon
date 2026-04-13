export namespace main {
	
	export class AgentContextDTO {
	    mode: string;
	    sessionId: string;
	    profileId: string;
	    dockerScope: string;
	    containerId: string;
	
	    static createFrom(source: any = {}) {
	        return new AgentContextDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.sessionId = source["sessionId"];
	        this.profileId = source["profileId"];
	        this.dockerScope = source["dockerScope"];
	        this.containerId = source["containerId"];
	    }
	}
	export class AiAgentExplainRequest {
	    kind: string;
	    command: string;
	    output: string;
	    agentContext: AgentContextDTO;
	
	    static createFrom(source: any = {}) {
	        return new AiAgentExplainRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.command = source["command"];
	        this.output = source["output"];
	        this.agentContext = this.convertValues(source["agentContext"], AgentContextDTO);
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
	export class AiAgentExplainResponse {
	    replyText: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AiAgentExplainResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.replyText = source["replyText"];
	        this.error = source["error"];
	    }
	}
	export class AiChatRequest {
	    conversationId: string;
	    userText: string;
	    agentContext: AgentContextDTO;
	
	    static createFrom(source: any = {}) {
	        return new AiChatRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversationId = source["conversationId"];
	        this.userText = source["userText"];
	        this.agentContext = this.convertValues(source["agentContext"], AgentContextDTO);
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
	export class AiPendingCommandDTO {
	    assistantMessageId: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new AiPendingCommandDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.assistantMessageId = source["assistantMessageId"];
	        this.command = source["command"];
	    }
	}
	export class AiMessageDTO {
	    id: string;
	    conversationId: string;
	    role: string;
	    payloadJson: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new AiMessageDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.conversationId = source["conversationId"];
	        this.role = source["role"];
	        this.payloadJson = source["payloadJson"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class AiChatResponse {
	    assistantMessage?: AiMessageDTO;
	    pendingCommand?: AiPendingCommandDTO;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AiChatResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.assistantMessage = this.convertValues(source["assistantMessage"], AiMessageDTO);
	        this.pendingCommand = this.convertValues(source["pendingCommand"], AiPendingCommandDTO);
	        this.error = source["error"];
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
	export class AiConversationListDTO {
	    id: string;
	    title: string;
	    updatedAt: string;
	    byteSize: number;
	
	    static createFrom(source: any = {}) {
	        return new AiConversationListDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.updatedAt = source["updatedAt"];
	        this.byteSize = source["byteSize"];
	    }
	}
	
	
	export class AiResolveCommandRequest {
	    conversationId: string;
	    assistantMessageId: string;
	    approved: boolean;
	    agentContext: AgentContextDTO;
	
	    static createFrom(source: any = {}) {
	        return new AiResolveCommandRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversationId = source["conversationId"];
	        this.assistantMessageId = source["assistantMessageId"];
	        this.approved = source["approved"];
	        this.agentContext = this.convertValues(source["agentContext"], AgentContextDTO);
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
	export class AiSettingsDTO {
	    integrationType: string;
	    baseURL: string;
	    model: string;
	    maxTokensPerRequest: number;
	    contextTokenLimit: number;
	    summaryKeepLastMessages: number;
	    apiKeySet: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AiSettingsDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.integrationType = source["integrationType"];
	        this.baseURL = source["baseURL"];
	        this.model = source["model"];
	        this.maxTokensPerRequest = source["maxTokensPerRequest"];
	        this.contextTokenLimit = source["contextTokenLimit"];
	        this.summaryKeepLastMessages = source["summaryKeepLastMessages"];
	        this.apiKeySet = source["apiKeySet"];
	    }
	}
	export class AiUsagePointDTO {
	    day: string;
	    totalTokens: number;
	
	    static createFrom(source: any = {}) {
	        return new AiUsagePointDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.day = source["day"];
	        this.totalTokens = source["totalTokens"];
	    }
	}
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
	    isSymlink: boolean;
	    linkTarget?: string;
	
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
	        this.isSymlink = source["isSymlink"];
	        this.linkTarget = source["linkTarget"];
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
	export class DockerNetworkDTO {
	    id: string;
	    name: string;
	    driver?: string;
	    scope?: string;
	
	    static createFrom(source: any = {}) {
	        return new DockerNetworkDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.scope = source["scope"];
	    }
	}
	export class DockerNetworkDetailsDTO {
	    id: string;
	    name: string;
	    driver?: string;
	    scope?: string;
	    internal?: boolean;
	    attachable?: boolean;
	    ingress?: boolean;
	    containers?: string[];
	
	    static createFrom(source: any = {}) {
	        return new DockerNetworkDetailsDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.scope = source["scope"];
	        this.internal = source["internal"];
	        this.attachable = source["attachable"];
	        this.ingress = source["ingress"];
	        this.containers = source["containers"];
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
	export class DockerVolumeDTO {
	    name: string;
	    driver?: string;
	    scope?: string;
	
	    static createFrom(source: any = {}) {
	        return new DockerVolumeDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.scope = source["scope"];
	    }
	}
	export class DockerVolumeDetailsDTO {
	    name: string;
	    driver?: string;
	    mountpoint?: string;
	    scope?: string;
	    createdAt?: string;
	    labels?: Record<string, string>;
	    options?: Record<string, string>;
	    refCount?: number;
	    sizeBytes?: number;
	    usedBy?: string[];
	
	    static createFrom(source: any = {}) {
	        return new DockerVolumeDetailsDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.mountpoint = source["mountpoint"];
	        this.scope = source["scope"];
	        this.createdAt = source["createdAt"];
	        this.labels = source["labels"];
	        this.options = source["options"];
	        this.refCount = source["refCount"];
	        this.sizeBytes = source["sizeBytes"];
	        this.usedBy = source["usedBy"];
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
	export class ListLogSourcesRequest {
	    kind: string;
	    profileId: string;
	    containerName: string;
	
	    static createFrom(source: any = {}) {
	        return new ListLogSourcesRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	    }
	}
	export class LogEntryDTO {
	    id: string;
	    sourceId: string;
	    kind: string;
	    profileId: string;
	    containerName: string;
	    sourcePath: string;
	    timestampUnixMs: number;
	    ingestedUnixMs: number;
	    timestampSource: string;
	    level: string;
	    levelSource: string;
	    message: string;
	    rawText: string;
	
	    static createFrom(source: any = {}) {
	        return new LogEntryDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sourceId = source["sourceId"];
	        this.kind = source["kind"];
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	        this.sourcePath = source["sourcePath"];
	        this.timestampUnixMs = source["timestampUnixMs"];
	        this.ingestedUnixMs = source["ingestedUnixMs"];
	        this.timestampSource = source["timestampSource"];
	        this.level = source["level"];
	        this.levelSource = source["levelSource"];
	        this.message = source["message"];
	        this.rawText = source["rawText"];
	    }
	}
	export class LogFormatDTO {
	    id: string;
	    name: string;
	    description: string;
	    builtinKey: string;
	    parserType: string;
	    pattern: string;
	    timeLayout: string;
	    captureGroupsJson: string;
	    levelMappingJson: string;
	    isSystem: boolean;
	    enabled: boolean;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new LogFormatDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.builtinKey = source["builtinKey"];
	        this.parserType = source["parserType"];
	        this.pattern = source["pattern"];
	        this.timeLayout = source["timeLayout"];
	        this.captureGroupsJson = source["captureGroupsJson"];
	        this.levelMappingJson = source["levelMappingJson"];
	        this.isSystem = source["isSystem"];
	        this.enabled = source["enabled"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class LogParseDraftDTO {
	    pattern: string;
	    timeLayout: string;
	    captureGroupsJson: string;
	    levelMappingJson: string;
	    raw: string;
	
	    static createFrom(source: any = {}) {
	        return new LogParseDraftDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pattern = source["pattern"];
	        this.timeLayout = source["timeLayout"];
	        this.captureGroupsJson = source["captureGroupsJson"];
	        this.levelMappingJson = source["levelMappingJson"];
	        this.raw = source["raw"];
	    }
	}
	export class LogParsePreviewRecordDTO {
	    matched: boolean;
	    route: string;
	    timestampUnixMs: number;
	    timestampSource: string;
	    level: string;
	    levelSource: string;
	    message: string;
	    rawText: string;
	    metaJson: string;
	
	    static createFrom(source: any = {}) {
	        return new LogParsePreviewRecordDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.matched = source["matched"];
	        this.route = source["route"];
	        this.timestampUnixMs = source["timestampUnixMs"];
	        this.timestampSource = source["timestampSource"];
	        this.level = source["level"];
	        this.levelSource = source["levelSource"];
	        this.message = source["message"];
	        this.rawText = source["rawText"];
	        this.metaJson = source["metaJson"];
	    }
	}
	export class LogParsePreviewResultDTO {
	    compileError?: string;
	    records: LogParsePreviewRecordDTO[];
	
	    static createFrom(source: any = {}) {
	        return new LogParsePreviewResultDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.compileError = source["compileError"];
	        this.records = this.convertValues(source["records"], LogParsePreviewRecordDTO);
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
	export class LogSourceDTO {
	    id: string;
	    kind: string;
	    profileId: string;
	    containerName: string;
	    path: string;
	    formatId: string;
	    displayName: string;
	    optionsJson: string;
	    lastError: string;
	    lastSyncedAt?: string;
	    enabled: boolean;
	    order: number;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new LogSourceDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	        this.path = source["path"];
	        this.formatId = source["formatId"];
	        this.displayName = source["displayName"];
	        this.optionsJson = source["optionsJson"];
	        this.lastError = source["lastError"];
	        this.lastSyncedAt = source["lastSyncedAt"];
	        this.enabled = source["enabled"];
	        this.order = source["order"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class LogsPurgeRequest {
	    kind: string;
	    profileId: string;
	    containerName: string;
	    sourceId: string;
	    beforeUnixMs: number;
	
	    static createFrom(source: any = {}) {
	        return new LogsPurgeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	        this.sourceId = source["sourceId"];
	        this.beforeUnixMs = source["beforeUnixMs"];
	    }
	}
	export class LogsQueryRequest {
	    kind: string;
	    profileId: string;
	    containerName: string;
	    sourceId: string;
	    search: string;
	    levels: string[];
	    fromUnixMs: number;
	    toUnixMs: number;
	    ascending: boolean;
	    limit: number;
	    offset: number;
	
	    static createFrom(source: any = {}) {
	        return new LogsQueryRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	        this.sourceId = source["sourceId"];
	        this.search = source["search"];
	        this.levels = source["levels"];
	        this.fromUnixMs = source["fromUnixMs"];
	        this.toUnixMs = source["toUnixMs"];
	        this.ascending = source["ascending"];
	        this.limit = source["limit"];
	        this.offset = source["offset"];
	    }
	}
	export class LogsQueryResultDTO {
	    entries: LogEntryDTO[];
	    total: number;
	    levels: string[];
	    sourcePaths: string[];
	
	    static createFrom(source: any = {}) {
	        return new LogsQueryResultDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], LogEntryDTO);
	        this.total = source["total"];
	        this.levels = source["levels"];
	        this.sourcePaths = source["sourcePaths"];
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
	export class LogsSettingsDTO {
	    maxFileBytes: number;
	    defaultRetentionDays: number;
	    redactionPatterns: string[];
	
	    static createFrom(source: any = {}) {
	        return new LogsSettingsDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxFileBytes = source["maxFileBytes"];
	        this.defaultRetentionDays = source["defaultRetentionDays"];
	        this.redactionPatterns = source["redactionPatterns"];
	    }
	}
	export class LogsSyncRequest {
	    sourceId: string;
	    forceLarge: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LogsSyncRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceId = source["sourceId"];
	        this.forceLarge = source["forceLarge"];
	    }
	}
	export class LogsSyncResultDTO {
	    sourceId: string;
	    importedCount: number;
	    skippedCount: number;
	    bytesRead: number;
	    largeFile: boolean;
	    needsConfirm: boolean;
	    warning?: string;
	
	    static createFrom(source: any = {}) {
	        return new LogsSyncResultDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceId = source["sourceId"];
	        this.importedCount = source["importedCount"];
	        this.skippedCount = source["skippedCount"];
	        this.bytesRead = source["bytesRead"];
	        this.largeFile = source["largeFile"];
	        this.needsConfirm = source["needsConfirm"];
	        this.warning = source["warning"];
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
	export class PrivacyDockerLogBucketDTO {
	    containerName: string;
	    sourceCount: number;
	    entryCount: number;
	    lastSyncedUnixMs: number;
	    orphaned: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PrivacyDockerLogBucketDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.containerName = source["containerName"];
	        this.sourceCount = source["sourceCount"];
	        this.entryCount = source["entryCount"];
	        this.lastSyncedUnixMs = source["lastSyncedUnixMs"];
	        this.orphaned = source["orphaned"];
	    }
	}
	export class PrivacyDockerRemoteOrphanBucketDTO {
	    profileId: string;
	    containerName: string;
	    sourceCount: number;
	    entryCount: number;
	    lastSyncedUnixMs: number;
	
	    static createFrom(source: any = {}) {
	        return new PrivacyDockerRemoteOrphanBucketDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	        this.sourceCount = source["sourceCount"];
	        this.entryCount = source["entryCount"];
	        this.lastSyncedUnixMs = source["lastSyncedUnixMs"];
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
	export class SaveAiSettingsRequest {
	    settings: AiSettingsDTO;
	    apiKey: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveAiSettingsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = this.convertValues(source["settings"], AiSettingsDTO);
	        this.apiKey = source["apiKey"];
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
	export class SaveAiToolExplainRequest {
	    conversationId: string;
	    messageId: string;
	    explainText: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveAiToolExplainRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversationId = source["conversationId"];
	        this.messageId = source["messageId"];
	        this.explainText = source["explainText"];
	    }
	}
	export class SecretItemDTO {
	    profileId: string;
	    key: string;
	    storage: string;
	    metaJson: string;
	    updatedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new SecretItemDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.key = source["key"];
	        this.storage = source["storage"];
	        this.metaJson = source["metaJson"];
	        this.updatedAt = source["updatedAt"];
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
	export class SettingsDatabaseTableStatDTO {
	    tableName: string;
	    rowCount: number;
	
	    static createFrom(source: any = {}) {
	        return new SettingsDatabaseTableStatDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tableName = source["tableName"];
	        this.rowCount = source["rowCount"];
	    }
	}
	export class SettingsDatabaseStorageDTO {
	    dbPath: string;
	    fileBytes: number;
	    walBytes: number;
	    shmBytes: number;
	    tables: SettingsDatabaseTableStatDTO[];
	
	    static createFrom(source: any = {}) {
	        return new SettingsDatabaseStorageDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dbPath = source["dbPath"];
	        this.fileBytes = source["fileBytes"];
	        this.walBytes = source["walBytes"];
	        this.shmBytes = source["shmBytes"];
	        this.tables = this.convertValues(source["tables"], SettingsDatabaseTableStatDTO);
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
	
	export class SettingsPrivacyProfileDetailDTO {
	    profileId: string;
	    passwordStorage: string;
	    passwordSet: boolean;
	    privateKeyStorage: string;
	    privateKeySet: boolean;
	    customSecrets: SecretItemDTO[];
	    vaultItemCount: number;
	    logProfileSourceCount: number;
	    logEntryCount: number;
	    logLastSyncedUnixMs: number;
	
	    static createFrom(source: any = {}) {
	        return new SettingsPrivacyProfileDetailDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.passwordStorage = source["passwordStorage"];
	        this.passwordSet = source["passwordSet"];
	        this.privateKeyStorage = source["privateKeyStorage"];
	        this.privateKeySet = source["privateKeySet"];
	        this.customSecrets = this.convertValues(source["customSecrets"], SecretItemDTO);
	        this.vaultItemCount = source["vaultItemCount"];
	        this.logProfileSourceCount = source["logProfileSourceCount"];
	        this.logEntryCount = source["logEntryCount"];
	        this.logLastSyncedUnixMs = source["logLastSyncedUnixMs"];
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
	export class SettingsPrivacyReportDTO {
	    dbPath: string;
	    profileCount: number;
	    placeCount: number;
	    macroCount: number;
	    secretRefCount: number;
	    vaultItemCount: number;
	    aiConversationCount: number;
	    logSourceCount: number;
	    logEntryCount: number;
	    logFormatCount: number;
	
	    static createFrom(source: any = {}) {
	        return new SettingsPrivacyReportDTO(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dbPath = source["dbPath"];
	        this.profileCount = source["profileCount"];
	        this.placeCount = source["placeCount"];
	        this.macroCount = source["macroCount"];
	        this.secretRefCount = source["secretRefCount"];
	        this.vaultItemCount = source["vaultItemCount"];
	        this.aiConversationCount = source["aiConversationCount"];
	        this.logSourceCount = source["logSourceCount"];
	        this.logEntryCount = source["logEntryCount"];
	        this.logFormatCount = source["logFormatCount"];
	    }
	}
	export class UpsertLogFormatRequest {
	    id?: string;
	    name: string;
	    description: string;
	    parserType: string;
	    pattern: string;
	    timeLayout: string;
	    captureGroupsJson: string;
	    levelMappingJson: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UpsertLogFormatRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.parserType = source["parserType"];
	        this.pattern = source["pattern"];
	        this.timeLayout = source["timeLayout"];
	        this.captureGroupsJson = source["captureGroupsJson"];
	        this.levelMappingJson = source["levelMappingJson"];
	        this.enabled = source["enabled"];
	    }
	}
	export class UpsertLogSourceRequest {
	    id?: string;
	    kind: string;
	    profileId: string;
	    containerName: string;
	    path: string;
	    formatId: string;
	    displayName: string;
	    optionsJson: string;
	    enabled: boolean;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new UpsertLogSourceRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.profileId = source["profileId"];
	        this.containerName = source["containerName"];
	        this.path = source["path"];
	        this.formatId = source["formatId"];
	        this.displayName = source["displayName"];
	        this.optionsJson = source["optionsJson"];
	        this.enabled = source["enabled"];
	        this.order = source["order"];
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
	export class UpsertSecretRequest {
	    profileId: string;
	    key: string;
	    storage: string;
	    value: string;
	    metaJson?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpsertSecretRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.key = source["key"];
	        this.storage = source["storage"];
	        this.value = source["value"];
	        this.metaJson = source["metaJson"];
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
	    isSymlink: boolean;
	    linkTarget?: string;
	
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
	        this.isSymlink = source["isSymlink"];
	        this.linkTarget = source["linkTarget"];
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

