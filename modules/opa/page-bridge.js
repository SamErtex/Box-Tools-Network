(() => {
  "use strict";

  // Executa no MAIN world, em document_start, antes de o Socket.IO abrir o WebSocket.
  if (window.__OPA_AUTO_BRIDGE_V59__) return;
  window.__OPA_AUTO_BRIDGE_V59__ = true;

  const POST_TYPE = "OPA_AUTO_BRIDGE";
  const MARK_WAITING_MAX_ATTEMPTS = 4;
  const MARK_WAITING_RETRY_DELAYS = [750, 1500, 3000];
  const ASSUMPTION_CONFIRMATION_TIMEOUT = 18000;
  const QUEUE_REFRESH_DEBOUNCE_MS = 350;
  const QUEUE_REFRESH_MIN_INTERVAL_MS = 1200;
  const waitingMarkInFlight = new Set();
  const monitoredIds = new Set();
  const confirmedAssumptions = new Set();
  const knownWaitingIds = new Set();
  const pendingAssumptions = new Map();
  const activeIds = new Set();

  let currentUserId = "";
  let debugEnabled = false;
  let applicationSocket = null;
  let socketBackendReady = false;
  let latestDepartmentItems = [];
  let latestInProgressItems = [];
  let queueWasLoaded = false;
  let inProgressWasLoaded = false;
  let pendingQueueRefresh = false;
  let queueRefreshTimer = null;
  let lastQueueRefreshAt = 0;
  let queueRefreshInFlight = false;
  // Sequência observada na interface; o fallback usa os argumentos reais
  // capturados no teste quando ainda não houve abertura manual da aba Fila.
  let departmentRefreshRequestSource = "tested-fallback";
  let latestDepartmentRefreshRequests = [
    {
      eventName: "customer-services-ui:customer-service-queues:department:load-customer-services",
      args: [{ advancedFilters: [], roleFilter: "" }]
    },
    {
      eventName: "customer-services-ui:customer-service-queues:department:list",
      args: [{
        advancedFilters: [],
        page: 1,
        preferences: { sortBy: "interaction", sortOrder: "desc" }
      }]
    }
  ];

  function send(action, data = {}) {
    window.postMessage({ type: POST_TYPE, action, ...data }, window.location.origin);
  }

  let suppressedSocketEvents = 0;

  function debugLog(message, details) {
    if (!debugEnabled) return;
    const text = String(message || "");
    const isError = /falha|erro|timeout|bloqueada|abortada|ignorada/i.test(text);
    const isSuccess = /confirmad|sucesso|pronto|aberto/i.test(text);
    const color = isError ? "#dc2626" : isSuccess ? "#15803d" : "#2563eb";
    console.log(`%c OPA DEBUG %c BRIDGE %c ${text}`,
      "background:#172554;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
      "background:#dbeafe;color:#1e3a8a;font-weight:700;padding:2px 6px;border-radius:3px",
      `color:${color};font-weight:600`, ...(details === undefined ? [] : [details]));
  }

  function isRelevantSocketEvent(eventName) {
    return eventName === "con" ||
      eventName === "customer-service:take-over" ||
      eventName === "customer-service:transfer-to-department" ||
      eventName === "customer-service:new" ||
      eventName === "customer-services-ui:customer-service-queues:department:list" ||
      eventName === "customer-services-ui:customer-service-queues:in-progress:list" ||
      eventName === "customer-services-ui:customer-service-actions:take-over:progress" ||
      eventName.includes("customer-service-queues:finished:list");
  }

  // Diagnóstico temporário: captura pacotes de entrada/saída relacionados à fila.
  // Os payloads completos só são exibidos quando teste1234() está ativo.
  let opaSocketEmission = false;

  function isQueueDiagnosticEvent(eventName) {
    return typeof eventName === "string" && (
      eventName.includes("customer-service-queues") ||
      eventName.includes("load-customer-services") ||
      eventName.includes("customer-service:new") ||
      eventName.includes("transfer-to-department") ||
      eventName.includes("customer-service-actions:department:take-over") ||
      eventName.includes("customer-service-actions:take-over:progress") ||
      eventName === "customer-service:take-over"
    );
  }

  function decodeSocketEventFrame(frame) {
    if (typeof frame !== "string" || !frame.startsWith("42")) return null;
    // Socket.IO pode inserir namespace e/ou ACK ID entre o tipo 42 e o JSON.
    // Procurar o início do array evita falhas em pacotes como 423["evento", ...].
    const jsonStart = frame.indexOf("[", 2);
    if (jsonStart < 0) return null;
    const packet = JSON.parse(frame.slice(jsonStart));
    return Array.isArray(packet) && typeof packet[0] === "string" ? packet : null;
  }

  function rememberDepartmentRefreshRequest(eventName, packet) {
    const isLoad = eventName === "customer-services-ui:customer-service-queues:department:load-customer-services";
    const isList = eventName === "customer-services-ui:customer-service-queues:department:list";
    if (!isLoad && !isList) return;

    const request = {
      eventName,
      args: packet.slice(1)
    };
    if (isLoad) {
      latestDepartmentRefreshRequests = [request];
      departmentRefreshRequestSource = "interface-captured";
    } else if (latestDepartmentRefreshRequests.length) {
      departmentRefreshRequestSource = "interface-captured";
      // Mantém a ordem observada na interface: load-customer-services e list.
      const existingIndex = latestDepartmentRefreshRequests.findIndex(item => item.eventName === eventName);
      if (existingIndex >= 0) latestDepartmentRefreshRequests[existingIndex] = request;
      else latestDepartmentRefreshRequests.push(request);
    } else {
      latestDepartmentRefreshRequests = [request];
      departmentRefreshRequestSource = "interface-captured";
    }
  }

  function logSocketPacket(raw, direction) {
    if (typeof raw !== "string") return;

    for (const frame of raw.split("\x1e")) {
      if (!frame.startsWith("42")) continue;
      try {
        const packet = decodeSocketEventFrame(frame);
        if (!packet) continue;
        const [eventName, payload] = packet;
        if (direction === "OUT" && !opaSocketEmission) {
          rememberDepartmentRefreshRequest(eventName, packet);
          if (eventName === "customer-services-ui:customer-service-queues:department:load-customer-services") {
            pendingQueueRefresh = false;
          }
        }
        if (!debugEnabled || !isQueueDiagnosticEvent(eventName)) continue;

        const directionLabel = direction === "OUT" ? (opaSocketEmission ? "OPA → IXC" : "INTERFACE → IXC") : "IXC → INTERFACE";
        const color = direction === "OUT" ? "#7c3aed" : "#0369a1";
        console.groupCollapsed(
          `%c OPA SOCKET %c ${directionLabel} %c ${eventName}`,
          "background:#111827;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
          `background:${color};color:#fff;font-weight:700;padding:2px 6px;border-radius:3px`,
          "color:#111827;font-weight:600"
        );
        console.log("Horário:", new Date().toISOString());
        console.log("Evento:", eventName);
        console.log("Payload completo:");
        console.dir(payload, { depth: null });
        console.log("Pacote Socket.IO completo:");
        console.dir(packet, { depth: null });
        console.groupEnd();
      } catch (error) {
        debugLog("Pacote Socket.IO ignorado pelo diagnóstico.", {
          direction,
          reason: error?.message || String(error),
          framePrefix: frame.slice(0, 120)
        });
      }
    }
  }

  function attachSocketSendCapture(socket) {
    if (!socket || socket.__opaOutgoingCaptureInstalled) return;
    const originalSend = socket.send;
    if (typeof originalSend !== "function") return;

    try {
      socket.send = function (data) {
        try { logSocketPacket(data, "OUT"); } catch (_) {}
        return Reflect.apply(originalSend, this, arguments);
      };
      Object.defineProperty(socket, "__opaOutgoingCaptureInstalled", { value: true });
    } catch (error) {
      debugLog("Não foi possível instalar captura dos eventos enviados pela interface.", { error });
    }
  }

  // Comandos disponíveis diretamente no console da página do IXC.
  window.teste1234 = () => {
    debugEnabled = true;
    send("DEBUG_STATE", { enabled: true });
    console.info("[OPA DEBUG] Debug ativado. Para encerrar, execute encerrou1234().");
    debugLog("Estado inicial do bridge.", {
      socketExists: Boolean(applicationSocket),
      socketReadyState: applicationSocket?.readyState,
      socketBackendReady,
      queueWasLoaded,
      queueLength: latestDepartmentItems.length,
      currentUserId
    });
    return "OPA DEBUG ATIVADO";
  };

  window.encerrou1234 = () => {
    debugLog("Debug encerrado pelo usuário.");
    debugEnabled = false;
    send("DEBUG_STATE", { enabled: false });
    console.info("[OPA DEBUG] Debug desativado.");
    return "OPA DEBUG DESATIVADO";
  };

  function normalizeId(value) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") return value._id || value.id || "";
    return "";
  }

  function getStatus(item) {
    return String(item?.status || "").trim().toUpperCase();
  }

  function getDepartment(item) {
    return item?.setor || item?.department || {};
  }

  function getOperations(item) {
    const operations = item?.operacoes || item?.operations || [];
    return Array.isArray(operations) ? operations : [];
  }

  function getQueueSince(item) {
    if (getStatus(item) !== "AG") return "";

    const operations = getOperations(item);
    const transfer = operations.slice().reverse().find(operation =>
      (operation?.tipo || operation?.type) === "transferirDepartamento"
    );
    const value = transfer?.date || item?.date || item?.openingDate || "";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  }

  function toQueueRecord(item) {
    const department = getDepartment(item);
    const id = item?._id || item?.id || "";
    if (!id) return null;

    return {
      id,
      protocolo: item.protocolo || item.protocol || id,
      canal: item.canal || item.communicationChannelType || "",
      status: item.status || "",
      departamento: department.nome || department.name || "",
      departamentoId: department._id || department.id || "",
      filaDesde: getQueueSince(item),
      idAtendente: normalizeId(item.id_atendente || item.attendant?.id || item.attendant),
      data: item.date || item.openingDate || ""
    };
  }

  function isWaitingQueueItem(item) {
    const id = item?._id || item?.id;
    const attendantId = normalizeId(item?.id_atendente || item?.attendant?.id || item?.attendant);
    return Boolean(
      id &&
      getStatus(item) === "AG" &&
      !attendantId &&
      !confirmedAssumptions.has(id)
    );
  }

  function publishQueue() {
    // department:list pode continuar contendo, por alguns instantes, um registro
    // antigo mesmo depois da confirmação da assunção. A fila do OPA deve refletir
    // apenas atendimentos realmente aguardando: AG, sem atendente e não confirmados.
    const queue = latestDepartmentItems
      .filter(isWaitingQueueItem)
      .map(toQueueRecord)
      .filter(Boolean);
    send("FILA_ATUALIZADA", { queue });
  }

  function confirmAssumption(item, source, matchedOwnRequest = false) {
    const id = item?._id || item?.id;
    const pending = pendingAssumptions.get(id);
    const attendantId = normalizeId(item?.id_atendente || item?.attendant?.id || item?.attendant);
    const isOwnPendingRequest = pending?.source === "opa" && (
      matchedOwnRequest || (Boolean(currentUserId) && attendantId === currentUserId)
    );
    debugLog("Validando confirmação de assunção.", {
      id,
      source,
      matchedOwnRequest,
      ownPendingRequest: isOwnPendingRequest,
      status: getStatus(item),
      confirmedAlready: confirmedAssumptions.has(id)
    });
    if (!id || (confirmedAssumptions.has(id) && !isOwnPendingRequest)) return;

    // A resposta customer-service:take-over confirma uma solicitação que este
    // bridge acabou de emitir. Para assunções manuais, exigimos o ID do usuário
    // autenticado para não confundir ações de outros atendentes.
    if (!attendantId) {
      debugLog("Confirmação ignorada: atendimento sem id_atendente.", { id });
      return;
    }
    if (currentUserId && attendantId !== currentUserId) {
      debugLog("Confirmação ignorada: atendimento assumido por outro usuário.", { id, attendantId, currentUserId });
      return;
    }
    if (!currentUserId && !isOwnPendingRequest) {
      debugLog("Confirmação ignorada: usuário atual ainda não identificado.", { id });
      return;
    }

    if (pending?.timeout) clearTimeout(pending.timeout);
    confirmedAssumptions.add(id);
    pendingAssumptions.delete(id);
    knownWaitingIds.delete(id);
    activeIds.add(id);

    // Atualiza também o snapshot em memória. Mesmo que o próximo department:list
    // demore ou repita um registro antigo, o painel do OPA já remove este ID.
    latestDepartmentItems = latestDepartmentItems.map(queueItem => {
      const queueItemId = queueItem?._id || queueItem?.id;
      if (queueItemId !== id) return queueItem;
      return {
        ...queueItem,
        status: "EA",
        id_atendente: attendantId
      };
    });
    monitoredIds.add(id);

    const department = getDepartment(item);
    const recordSource = source === "opa" ? "opa" : "manual";
    debugLog("Assunção confirmada.", {
      id, attendantId, source: recordSource,
      elapsedMs: pending ? Date.now() - pending.startedAt : null
    });

    send("ATENDIMENTO_ASSUMIDO", {
      record: {
        id,
        protocolo: item.protocolo || item.protocol || id,
        idAtendente: attendantId,
        departamento: department.nome || department.name || "",
        canal: item.canal || item.communicationChannelType || "",
        assumidoEm: Date.now(),
        source: recordSource,
        assumedByOPA: recordSource === "opa"
      }
    });
    publishQueue();
  }

  function handleDepartmentList(payload) {
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items)) {
      debugLog("Evento de fila recebido com formato inesperado.", payload);
      return;
    }

    latestDepartmentItems = items;
    queueWasLoaded = true;
    pendingQueueRefresh = false;
    if (queueRefreshTimer) {
      clearTimeout(queueRefreshTimer);
      queueRefreshTimer = null;
    }
    debugLog("Lista da fila recebida pelo Socket.IO; snapshot atualizado.", {
      receivedAt: new Date().toISOString(),
      total: items.length,
      waiting: items.filter(isWaitingQueueItem).length,
      ignoredAlreadyConfirmed: items.filter(item => {
        const id = item?._id || item?.id;
        return Boolean(id && confirmedAssumptions.has(id));
      }).length,
      socketBackendReady,
      currentUserId,
      payloadType: Array.isArray(payload) ? "array" : typeof payload,
      payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : []
    });
    if (debugEnabled) {
      console.groupCollapsed(
        `%c OPA FILA %c department:list — ${items.length} registro(s) recebido(s)`,
        "background:#172554;color:#fff;font-weight:700;padding:2px 6px;border-radius:3px",
        "color:#1d4ed8;font-weight:700"
      );
      console.log("Payload original completo recebido do IXC:");
      console.dir(payload, { depth: null });
      console.log("Itens originais da fila (sem transformação do OPA):");
      console.dir(items, { depth: null });
      console.table(items.map((item, index) => ({
        indice: index,
        id: item?._id || item?.id || "",
        protocolo: item?.protocolo || item?.protocol || "",
        status: item?.status,
        id_atendente: item?.id_atendente,
        setor: item?.setor?.nome || item?.setor?.name || item?.department?.name || "",
        setor_id: item?.setor?._id || item?.setor?.id || item?.department?._id || item?.department?.id || "",
        canal: item?.canal || item?.communicationChannelType || item?.channel || "",
        campos: Object.keys(item || {}).join(", ")
      })));
      console.groupEnd();
    }
    socketBackendReady = true;

    for (const item of items) {
      const id = item?._id || item?.id;
      if (!id) continue;

      if (isWaitingQueueItem(item)) {
        knownWaitingIds.add(id);
      } else {
        knownWaitingIds.delete(id);
      }

      // Se um atendimento monitorado voltou à fila depois de já ter sido assumido,
      // consideramos uma transferência e cancelamos o alerta pendente.
      if (
        monitoredIds.has(id) &&
        getStatus(item) === "AG" &&
        !activeIds.has(id) &&
        !confirmedAssumptions.has(id)
      ) {
        // Não tratar uma cópia AG atrasada como retorno à fila. Uma assunção
        // confirmada permanece excluída até o ciclo de encerramento/transferência.
        monitoredIds.delete(id);
        activeIds.delete(id);
        send("ATENDIMENTO_TRANSFERIDO", { id });
      }
    }

    publishQueue();
    // Reavalia a última lista em andamento caso ela tenha chegado antes da fila.
    if (inProgressWasLoaded && currentUserId) {
      handleInProgressList({ items: latestInProgressItems });
    }
  }

  function handleInProgressList(payload) {
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items)) return;

    latestInProgressItems = items;
    socketBackendReady = true;
    const wasFirstInProgressSnapshot = !inProgressWasLoaded;
    inProgressWasLoaded = true;
    activeIds.clear();

    for (const item of items) {
      const id = item?._id || item?.id;
      if (!id) continue;

      const status = getStatus(item);
      const attendantId = normalizeId(item.id_atendente || item.attendant?.id || item.attendant);
      if (status === "EA" && attendantId) {
        if (attendantId === currentUserId) {
          activeIds.add(id);

          const pending = pendingAssumptions.get(id);
          if (pending) {
            confirmAssumption(item, pending.source);
          } else if (!wasFirstInProgressSnapshot && knownWaitingIds.has(id)) {
            const currentQueueItem = latestDepartmentItems.find(queueItem =>
              (queueItem?._id || queueItem?.id) === id
            );
            const leftWaitingQueue = queueWasLoaded && (
              !currentQueueItem ||
              getStatus(currentQueueItem) !== "AG" ||
              Boolean(normalizeId(currentQueueItem.id_atendente))
            );
            if (leftWaitingQueue) {
              // Só classifica como manual quando já existe snapshot da fila e
              // ele confirma que o atendimento saiu do estado AG sem atendente.
              confirmAssumption(item, "manual");
            } else {
              debugLog("Possível confirmação manual ignorada: ainda não há evidência de que o atendimento saiu da fila AG.", {
                id,
                queueWasLoaded,
                currentQueueStatus: getStatus(currentQueueItem),
                currentQueueAttendantId: normalizeId(currentQueueItem?.id_atendente)
              });
            }
          }
        }
      }
    }

    if (wasFirstInProgressSnapshot) return;
  }

  function handleFinishedList(payload) {
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const id = item?._id || item?.id;
      if (id && monitoredIds.has(id)) {
        monitoredIds.delete(id);
        confirmedAssumptions.delete(id);
        activeIds.delete(id);
        send("ATENDIMENTO_TRANSFERIDO", { id });
      }
    }
  }

  function handleTakeOverEvent(payload) {
    const item = payload?.customerService || payload?.data?.customerService || payload;
    const id = item?._id || item?.id;
    debugLog("Evento customer-service:take-over recebido.", {
      id,
      status: getStatus(item),
      attendantId: normalizeId(item?.id_atendente || item?.attendant?.id || item?.attendant),
      currentUserId,
      hasPending: pendingAssumptions.has(id)
    });
    if (!id) return;

    if (getStatus(item) !== "EA") {
      debugLog("Evento de assunção ignorado porque o status não é EA.", { id, status: getStatus(item) });
      return;
    }

    const pending = pendingAssumptions.get(id);
    if (pending) {
      // Resposta do backend à nossa emissão. O próprio ID de atendimento
      // correlaciona a confirmação, e id_atendente impede aceitar resposta vazia.
      confirmAssumption(item, pending.source, true);
      return;
    }

    // A mesma confirmação também pode sinalizar uma ação manual. Só aceitamos
    // essa origem quando o atendimento estava na fila e pertence ao usuário logado.
    const attendantId = normalizeId(item.id_atendente || item.attendant?.id || item.attendant);
    if (currentUserId && attendantId === currentUserId && knownWaitingIds.has(id)) {
      confirmAssumption(item, "manual");
    }
  }

  function handleTakeOverProgress(payload) {
    const failedIds = Array.isArray(payload?.failedCustomerServiceIds)
      ? payload.failedCustomerServiceIds
      : [];

    for (const id of failedIds) {
      const pending = pendingAssumptions.get(id);
      if (!pending) continue;
      if (pending.timeout) clearTimeout(pending.timeout);
      pendingAssumptions.delete(id);
      send("ASSUMIR_RESULTADO", {
        id,
        ok: false,
        reason: "backend-reported-take-over-failure"
      });
    }
  }

  function handleSocketEvent(eventName, payload) {
    if (eventName === "con") {
      socketBackendReady = true;
      currentUserId = normalizeId(payload?.user || payload?.usuario || payload);
      debugLog("Socket.IO evento con recebido; backend marcado como pronto.", { currentUserId });
      if (currentUserId && inProgressWasLoaded) {
        handleInProgressList({ items: latestInProgressItems });
      }
      if (pendingQueueRefresh) requestDepartmentQueueRefresh();
      return;
    }

    if (eventName === "customer-services-ui:customer-service-queues:department:list") {
      handleDepartmentList(payload);
      return;
    }

    if (eventName === "customer-services-ui:customer-service-queues:in-progress:list") {
      handleInProgressList(payload);
      return;
    }

    if (eventName === "customer-service:take-over") {
      handleTakeOverEvent(payload);
      return;
    }

    if (eventName === "customer-services-ui:customer-service-actions:take-over:progress") {
      handleTakeOverProgress(payload);
      return;
    }

    if (eventName.includes("customer-service-queues:finished:list")) {
      handleFinishedList(payload);
      return;
    }

    if (eventName === "customer-service:transfer-to-department" || eventName === "customer-service:new") {
      debugLog("Evento que pode alterar a fila recebido; agendando atualização do departamento.", {
        eventName,
        id: payload?._id || payload?.id || payload?.customerService?._id || payload?.customerService?.id || null,
        status: getStatus(payload?.customerService || payload),
        debounceMs: QUEUE_REFRESH_DEBOUNCE_MS
      });
      scheduleDepartmentQueueRefresh(eventName);
      return;
    }

    if (/mensagens|message/i.test(eventName)) {
      handleMessagePayload(payload);
    }
  }

  function parseSocketFrame(raw) {
    if (typeof raw !== "string") return;

    // Engine.IO pode agrupar pacotes usando o separador ASCII 0x1e.
    for (const frame of raw.split("\x1e")) {
      if (!frame.startsWith("42")) continue;
      try {
        const packet = decodeSocketEventFrame(frame);
        if (!packet) continue;
        if (isQueueDiagnosticEvent(packet[0]) && packet[0] !== "customer-services-ui:customer-service-queues:department:list") {
          logSocketPacket(frame, "IN");
        }

        if (isRelevantSocketEvent(packet[0])) {
          if (suppressedSocketEvents) {
            debugLog("Eventos Socket.IO auxiliares ignorados para evitar excesso de logs.", {
              quantidade: suppressedSocketEvents
            });
            suppressedSocketEvents = 0;
          }
          debugLog("Evento Socket.IO relevante recebido.", { eventName: packet[0] });
        } else {
          suppressedSocketEvents++;
        }
        handleSocketEvent(packet[0], packet[1]);
      } catch (error) {
        debugLog("Falha ao interpretar pacote Socket.IO.", { error, frame });
        // Ignora pacotes que não sejam eventos Socket.IO JSON.
      }
    }
  }

  function scheduleDepartmentQueueRefresh(reason = "evento") {
    pendingQueueRefresh = true;
    if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
    queueRefreshTimer = setTimeout(() => {
      queueRefreshTimer = null;
      requestDepartmentQueueRefresh(reason);
    }, QUEUE_REFRESH_DEBOUNCE_MS);
  }

  function requestDepartmentQueueRefresh(reason = "solicitação") {
    pendingQueueRefresh = true;

    if (!applicationSocket || applicationSocket.readyState !== 1 || !socketBackendReady) {
      debugLog("Atualização da fila aguardando conexão Socket.IO.", {
        reason,
        socketExists: Boolean(applicationSocket),
        socketReadyState: applicationSocket?.readyState,
        socketBackendReady
      });
      return false;
    }

    if (queueRefreshInFlight) {
      debugLog("Atualização da fila já está sendo enviada; solicitação agrupada.", { reason });
      return true;
    }

    const elapsed = Date.now() - lastQueueRefreshAt;
    if (elapsed < QUEUE_REFRESH_MIN_INTERVAL_MS) {
      const remaining = QUEUE_REFRESH_MIN_INTERVAL_MS - elapsed;
      if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
      queueRefreshTimer = setTimeout(() => {
        queueRefreshTimer = null;
        requestDepartmentQueueRefresh(reason);
      }, remaining);
      debugLog("Atualização da fila limitada para evitar excesso de emissões.", {
        reason,
        retryInMs: remaining
      });
      return true;
    }

    const requests = latestDepartmentRefreshRequests;
    if (!Array.isArray(requests) || requests.length === 0) {
      debugLog("Atualização da fila indisponível: nenhum argumento nativo foi capturado e não há fallback.", { reason });
      return false;
    }

    queueRefreshInFlight = true;
    lastQueueRefreshAt = Date.now();
    debugLog("Reproduzindo solicitação de atualização da fila com os argumentos capturados do IXC.", {
      reason,
      source: departmentRefreshRequestSource,
      requests
    });

    let allSent = true;
    for (const request of requests) {
      const sent = emitSocketArgs(request.eventName, request.args);
      allSent = allSent && sent;
      if (!sent) break;
    }

    // Libera o lock de emissão; o snapshot permanece pendente até chegar
    // department:list, que é a confirmação de que o IXC devolveu a fila.
    setTimeout(() => {
      queueRefreshInFlight = false;
    }, 250);

    if (!allSent) {
      debugLog("Nem todos os eventos de atualização da fila foram enviados.", { reason });
      return false;
    }
    return true;
  }

  function emitSocketEvent(eventName, payload) {
    return emitSocketArgs(eventName, [payload]);
  }

  function emitSocketArgs(eventName, args = []) {
    if (!applicationSocket || applicationSocket.readyState !== 1 || !socketBackendReady) {
      debugLog("Emissão bloqueada: Socket.IO não está pronto.", {
        eventName,
        socketExists: Boolean(applicationSocket),
        readyState: applicationSocket?.readyState,
        socketBackendReady
      });
      return false;
    }

    try {
      debugLog("Transmitindo evento Socket.IO.", { eventName, args });
      // Socket.IO sobre Engine.IO v4 usa o pacote "42" para eventos JSON.
      // Reaproveita os argumentos da interface sem copiar o ACK ID antigo.
      opaSocketEmission = true;
      applicationSocket.send(`42${JSON.stringify([eventName, ...args])}`);
      opaSocketEmission = false;
      debugLog("Evento Socket.IO enviado com sucesso.", { eventName });
      return true;
    } catch (error) {
      opaSocketEmission = false;
      debugLog("Erro ao transmitir evento Socket.IO.", { eventName, error });
      return false;
    }
  }

  function attachSocketCapture() {
    const NativeWebSocket = window.WebSocket;
    if (!NativeWebSocket || NativeWebSocket.__opaCaptureInstalled) return;

    const WrappedWebSocket = new Proxy(NativeWebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        const url = String(args?.[0] || "");

        // Não intercepta o WebSocket SIP (porta 8089); somente o Socket.IO da aplicação.
        if (/socket\.io/i.test(url) && /transport=websocket/i.test(url)) {
          applicationSocket = socket;
          attachSocketSendCapture(socket);
          debugLog("WebSocket Socket.IO capturado.", { url, readyState: socket.readyState });
          socketBackendReady = false;
          socket.addEventListener("message", event => {
            // Garante que a emissão use a conexão Socket.IO que está recebendo
            // os eventos atuais da aplicação, inclusive após reconexões.
            applicationSocket = socket;
            parseSocketFrame(event.data);
          });
          socket.addEventListener("open", () => {
            debugLog("WebSocket Socket.IO aberto.", { url, readyState: socket.readyState });
          });
          socket.addEventListener("error", error => {
            debugLog("Erro no WebSocket Socket.IO.", error);
          });
          socket.addEventListener("close", event => {
            debugLog("WebSocket Socket.IO fechado.", { code: event.code, reason: event.reason });
            if (applicationSocket === socket) {
              applicationSocket = null;
              socketBackendReady = false;
            }
          });
        }

        return socket;
      }
    });

    try {
      Object.defineProperty(WrappedWebSocket, "__opaCaptureInstalled", { value: true });
      Object.defineProperty(window, "WebSocket", {
        configurable: true,
        writable: true,
        value: WrappedWebSocket
      });
    } catch (_) {}
  }

  async function assumeSpecific(id) {
    debugLog("Solicitação de assunção recebida do content.js.", {
      id,
      queueLength: latestDepartmentItems.length,
      socketExists: Boolean(applicationSocket),
      socketReadyState: applicationSocket?.readyState,
      socketBackendReady
    });
    const item = latestDepartmentItems.find(candidate => (candidate?._id || candidate?.id) === id);
    if (!id || !item || getStatus(item) !== "AG" || normalizeId(item.id_atendente)) {
      debugLog("Assunção abortada na validação do atendimento.", {
        id,
        itemFound: Boolean(item),
        status: getStatus(item),
        attendantId: normalizeId(item?.id_atendente)
      });
      return false;
    }
    if (pendingAssumptions.has(id)) {
      debugLog("Já existe uma solicitação pendente para este atendimento.", { id });
      return true;
    }

    const queueRecord = toQueueRecord(item);
    const channel = item.canal || item.channel || item.communicationChannelType || "";
    if (!queueRecord?.protocolo || !channel) return false;

    const pending = {
      source: "opa",
      startedAt: Date.now(),
      protocolo: queueRecord.protocolo,
      timeout: null
    };
    pendingAssumptions.set(id, pending);

    const sent = emitSocketEvent(
      "customer-services-ui:customer-service-actions:department:take-over",
      {
        customerServicesData: [
          { id, channel }
        ]
      }
    );

    if (!sent) {
      pendingAssumptions.delete(id);
      debugLog("Solicitação não enviada; emitSocketEvent retornou false.", { id });
      return false;
    }

    debugLog("Solicitação enviada; aguardando confirmação do servidor.", {
      id,
      protocolo: pending.protocolo,
      timeoutMs: ASSUMPTION_CONFIRMATION_TIMEOUT
    });
    pending.timeout = setTimeout(() => {
      if (!pendingAssumptions.has(id)) return;
      debugLog("Timeout aguardando confirmação do servidor.", { id, elapsedMs: Date.now() - pending.startedAt });
      pendingAssumptions.delete(id);
      send("ASSUMIR_RESULTADO", {
        id,
        ok: false,
        reason: "take-over-confirmation-timeout"
      });
    }, ASSUMPTION_CONFIRMATION_TIMEOUT);

    return true;
  }

  async function markWaitingForCustomer(id, protocolo) {
    if (!id || waitingMarkInFlight.has(id)) return;
    waitingMarkInFlight.add(id);

    try {
      for (let attempt = 1; attempt <= MARK_WAITING_MAX_ATTEMPTS; attempt++) {
        let confirmed = false;
        try {
          const response = await fetch(
            "/services/customer-services-ui/customer-service-actions/state/set-awaiting-for-customer",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                customerServicesIds: [id],
                isAwaitingForCustomer: true
              })
            }
          );
          const result = await response.json().catch(() => null);
          confirmed = response.ok &&
            result?.type === "success" &&
            result?.data?.success === true;
        } catch (_) {
          confirmed = false;
        }

        if (confirmed) {
          send("AGUARDANDO_CLIENTE_OK", {
            id,
            protocolo: protocolo || id,
            attempts: attempt,
            confirmed: true
          });
          return;
        }

        if (attempt < MARK_WAITING_MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, MARK_WAITING_RETRY_DELAYS[attempt - 1]));
        }
      }

      send("AGUARDANDO_CLIENTE_ERRO", {
        id,
        protocolo: protocolo || id,
        attempts: MARK_WAITING_MAX_ATTEMPTS
      });
    } finally {
      waitingMarkInFlight.delete(id);
    }
  }

  function handleMessagePayload(payload) {
    const queue = [payload];
    const seen = new Set();
    let inspected = 0;

    while (queue.length && inspected++ < 250) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      if (Array.isArray(value)) {
        for (const item of value) queue.push(item);
        continue;
      }

      const routeId = normalizeId(value.id_rota || value.customerServiceId || value.customerService?._id);
      const senderId = normalizeId(value.id_atend || value.attendant || value.sender);
      const isSystem = value.systemMessage === true || value.systemNoteMessage === true;
      const text = String(value.mensagem || value.message || "").toLowerCase();
      const automatic = /iniciou o atendimento|foi um prazer atender|sua avalia[cç][aã]o|est[aá] na fila de atendimento/.test(text);

      if (routeId && monitoredIds.has(routeId) && senderId && senderId === currentUserId && !isSystem && !automatic) {
        monitoredIds.delete(routeId);
        send("ATENDENTE_COMUNICOU", { record: { id: routeId, idAtendente: senderId } });
      }

      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === "object") queue.push(child);
        if (typeof child === "string" && /customerServiceId|id_rota/i.test(key)) {
          // O próprio objeto já é inspecionado; não precisamos interpretar texto arbitrário.
        }
      }
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== POST_TYPE) return;

    if (data.action === "DEBUG_STATE") {
      debugEnabled = data.enabled === true;
      debugLog("Debug sincronizado com content.js.", { enabled: debugEnabled });
      return;
    }

    if (data.action === "OPA_CONTENT_READY") {
      debugLog("Content script sinalizou que está pronto.");
      send("BRIDGE_READY");
      if (queueWasLoaded) {
        debugLog("Entregando snapshot já carregado durante o handshake.", {
          total: latestDepartmentItems.length
        });
        publishQueue();
      }
      return;
    }

    if (data.action === "REQUEST_QUEUE_REFRESH") {
      requestDepartmentQueueRefresh();
      return;
    }

    if (data.action === "REQUEST_QUEUE_SNAPSHOT") {
      // Responde usando somente latestDepartmentItems, mantido em memória.
      // Não solicita lista ao IXC e não transmite nada pelo Socket.IO.
      debugLog("Solicitação de snapshot local recebida do AUTO.", {
        queueWasLoaded,
        total: latestDepartmentItems.length,
        socketReadyState: applicationSocket?.readyState,
        socketBackendReady
      });
      if (queueWasLoaded) {
        publishQueue();
      } else {
        debugLog("Ainda não existe snapshot local; aguardando o próximo evento department:list.");
      }
      return;
    }

    if (data.action === "RESTORE_MONITORS") {
      for (const monitor of Object.values(data.monitors || {})) {
        if (monitor?.id) monitoredIds.add(monitor.id);
      }
      return;
    }

    if (data.action === "ASSUMIR_ATENDIMENTO") {
      assumeSpecific(data.id)
        .then(ok => send("ASSUMIR_RESULTADO", {
          id: data.id,
          ok,
          reason: ok ? "click-dispatched" : "card-or-atender-button-not-found"
        }))
        .catch(() => send("ASSUMIR_RESULTADO", {
          id: data.id,
          ok: false,
          reason: "unexpected-error"
        }));
      return;
    }

    if (data.action === "MARCAR_AGUARDANDO_CLIENTE") {
      void markWaitingForCustomer(data.id, data.protocolo);
    }
  });

  attachSocketCapture();
  send("BRIDGE_READY");
})();
