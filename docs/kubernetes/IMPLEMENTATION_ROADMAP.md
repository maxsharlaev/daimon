# Kubernetes — implementation roadmap

This document outlines a phased plan to add Kubernetes support to daimon, aligned with existing patterns (SSH profiles, secrets storage, Docker local/remote modes).

## Goals

- Browse cluster resources from the desktop app with clear RBAC boundaries.
- Exec into pods (shell), stream logs, copy files to/from containers.
- Reuse existing trust model: local credentials, optional vault/keyring, no silent exfiltration.
- Match UX expectations set by Docker mode (sidebar → resource → tabs: logs / shell / files).

## Non-goals (initial phases)

- Replacing `kubectl` for every resource type and every API edge case.
- Multi-cluster GitOps, Helm UI, or full cluster admin replacement.
- Running a control plane or in-cluster agent (unless explicitly added later).

## Architecture (high level)

1. **Kubernetes client**: `client-go` (or `controller-runtime` if informers are needed later).
2. **Credentials**: standard kubeconfig loading (`KUBECONFIG`, default `~/.kube/config`), plus optional path per “Kubernetes profile” stored in app DB (references only; secrets via keyring/vault where applicable).
3. **Context**: user selects kube-context + default namespace; persist last choice per profile.
4. **Transport**: direct HTTPS from the desktop app to the cluster API server. Document firewall/VPN requirements.
5. **Remote clusters**: same as local if API is reachable; optional future: SSH tunnel / bastion (out of scope for MVP unless it becomes a product requirement).

## Phase 0 — Foundations (1–2 weeks, approximate)

- [ ] Add dependency: `k8s.io/client-go`, `k8s.io/apimachinery`.
- [ ] Implement `KubeClient` wrapper: load kubeconfig, build `rest.Config`, health check (`/version` or discovery).
- [ ] Define internal DTOs: `ClusterInfo`, `Namespace`, `NodeSummary`, `PodSummary`, `ContainerRef`.
- [ ] Error mapping: auth failures, forbidden (RBAC), unreachable API.
- [ ] Document in `PRIVACY.md` / security docs: what is stored locally (kubeconfig path, context name), what is never uploaded.

## Phase 1 — MVP: read-only cluster + pod exec (2–4 weeks)

**Read-only**

- [ ] List namespaces (or “all namespaces” toggle).
- [ ] List pods (namespace-scoped), basic filters (search by name).
- [ ] Pod details: phase, containers, node (if available), labels (collapsed).
- [ ] Optional: list Deployments / StatefulSets as navigation shortcuts (links to pods).

**Exec (shell)**

- [ ] `kubectl exec`-equivalent: attach to pod + container, TTY, stream stdin/stdout (reuse existing terminal/stream infrastructure where possible).
- [ ] Container picker for multi-container pods.

**Minimum viable UI**

- [ ] New mode entry (e.g. “Kubernetes”) parallel to Docker mode.
- [ ] Namespace selector + refresh.

**Security**

- [ ] No logging of bearer tokens / client certificates in debug logs.
- [ ] Clear message when RBAC denies access.

## Phase 2 — Logs + file copy (2–3 weeks)

- [ ] Stream logs: follow, tail lines, since, container selection, previous instance on crash.
- [ ] Copy files: pod → local, local → pod (`kubectl cp` semantics), progress events (pattern after SFTP transfers).
- [ ] Size limits / warnings for large files.

## Phase 3 — Operator workflows (2+ weeks)

- [ ] Describe resource + Events (pod events at minimum).
- [ ] Port-forward to Service/Pod (local port → remote), with explicit “listening on localhost” UX.
- [ ] Quick actions: delete pod (with confirmation), restart deployment (optional, gated).

## Phase 4 — Polish & enterprise-adjacent

- [ ] Multiple kube contexts as separate “profiles” or linked to SSH profile (product decision).
- [ ] Exec auth plugins (OIDC, cloud IAM): document supported kubeconfig features; test EKS/GKE/AKS common cases.
- [ ] Optional read-only metrics summary (node/pod resources) — only if aligned with product scope.

## Testing strategy

- [ ] Unit tests for kubeconfig loading and REST client creation (fake config).
- [ ] Integration tests against **kind** or **k3d** in CI (optional but valuable).
- [ ] Manual test matrix: minikube/kind, forbidden RBAC user, expired credentials.

## Documentation deliverables

- [ ] `docs/kubernetes/README.md` — user-facing: prerequisites, kubeconfig, limitations (optional index).
- [ ] Update root `README.md` — feature bullet when Kubernetes mode ships.
- [ ] Update `PRIVACY.md` / `docs/security/THREAT_MODEL.md` — API tokens, kubeconfig paths, cluster metadata in UI.

## Open decisions (resolve before heavy coding)

1. **Profile model**: separate “Kubernetes connection” entity vs. reuse `Profile` with a `kind: ssh|kube`.
2. **Default namespace**: remember per context vs. global.
3. **Remote API only** vs. **SSH tunnel** for private clusters (later phase).

## Success criteria

- User can: connect → pick namespace → open pod → shell + logs + small file copy without leaving the app.
- No secrets written to SQLite in plaintext; kubeconfig handling documented.
- Graceful degradation when RBAC blocks an action.
