export namespace main {
	
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

