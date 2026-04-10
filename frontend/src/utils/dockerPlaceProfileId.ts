/**
 * Canonical encoding for Place.profileId when the place belongs to Docker.
 *
 * v2 (preferred): docker:<scope>:<sshSegment>:name:<safeContainerName>
 *   - scope: local | remote
 *   - sshSegment: "local" for local Docker, or SSH Profile UUID for remote
 *   - safeContainerName: container name with ":" and control chars removed (stable across container ID changes)
 *
 * v1 (legacy): docker:<scope>:<sshSegment>:<containerId>
 *   - last segment was the Docker container ID (breaks after container recreate)
 *
 * Keep parse/build logic in this module only (DockerMode + Settings Places).
 */

export type DockerPlaceScope = "local" | "remote";

export type ParsedDockerPlaceProfileId =
  | {
      valid: true;
      version: 2;
      scope: DockerPlaceScope;
      sshSegment: string;
      /** Stable key: sanitized container name, or id_<containerId> fallback */
      containerKey: string;
    }
  | {
      valid: true;
      version: 1;
      scope: DockerPlaceScope;
      sshSegment: string;
      containerId: string;
    }
  | { valid: false };

export function sanitizeDockerPlaceNameSegment(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s
    .replace(/:/g, "_")
    .replace(/[\u0000-\u001f\\]/g, "_")
    .slice(0, 200);
}

/**
 * Build v2 profileId for saving Docker-related places.
 */
export function buildDockerPlaceProfileId(
  scope: DockerPlaceScope,
  sshProfileId: string | null | undefined,
  containerName: string,
  containerId: string
): string {
  const sshSeg = scope === "remote" ? (sshProfileId?.trim() || "unknown") : "local";
  let nameSeg = sanitizeDockerPlaceNameSegment(containerName);
  if (!nameSeg) {
    const idPart = sanitizeDockerPlaceNameSegment(containerId) || "container";
    nameSeg = `id_${idPart}`;
  }
  return `docker:${scope}:${sshSeg}:name:${nameSeg}`;
}

export function parseDockerPlaceProfileId(profileId: string): ParsedDockerPlaceProfileId {
  const parts = String(profileId ?? "").split(":");
  if (parts.length < 4 || parts[0] !== "docker") {
    return { valid: false };
  }
  const scope = parts[1] as DockerPlaceScope;
  if (scope !== "local" && scope !== "remote") {
    return { valid: false };
  }
  const sshSegment = parts[2] ?? "";
  if (parts[3] === "name" && parts.length >= 5) {
    const containerKey = parts.slice(4).join(":");
    if (!containerKey) return { valid: false };
    return { valid: true, version: 2, scope, sshSegment, containerKey };
  }
  const containerId = parts.slice(3).join(":");
  if (!containerId) return { valid: false };
  return { valid: true, version: 1, scope, sshSegment, containerId };
}

export function isDockerPlaceProfileId(profileId: string): boolean {
  return parseDockerPlaceProfileId(profileId).valid;
}
