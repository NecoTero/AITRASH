const bpmnProcess = {
  id: "documentation-approval",
  title: "Принцип согласования документации",
  roles: [
    { id: "designer", title: "Проектировщик" },
    { id: "gip-customer", title: "ГИП (Заказчик)" },
    { id: "gip", title: "ГИП" },
    { id: "specialist-1", title: "Проверяющий специалист №1" },
    { id: "specialist-2", title: "Проверяющий специалист №2" },
    { id: "specialist-3", title: "Проверяющий специалист №3" },
    { id: "system", title: "Sarex" }
  ],
  nodes: [
    {
      id: "start-album",
      type: "startEvent",
      title: "Альбом разработан",
      roleId: "designer",
      x: 80,
      y: 210,
      comment: "Начало процесса: проектировщик подготовил альбом для направления на согласование."
    },
    {
      id: "submit-route",
      type: "task",
      number: 1,
      title: "Загрузить альбом и направить на согласование",
      roleId: "designer",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "-",
      x: 210,
      y: 175,
      comment: "Проектировщик загружает альбом в Sarex и направляет его на согласование по соответствующему маршруту."
    },
    {
      id: "mail-to-gip",
      type: "messageEvent",
      title: "Автоматическое письмо на почту",
      roleId: "system",
      x: 560,
      y: 205,
      comment: "Система отправляет автоматическое уведомление о поступлении документации на согласование."
    },
    {
      id: "primary-check",
      type: "task",
      number: 2,
      title: "Провести первичную проверку альбома",
      roleId: "gip-customer",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 720,
      y: 175,
      comment: "ГИП проводит первичную проверку поступившего альбома: подтверждает наличие альбома в системе и проверяет достаточность состава для дальнейшей технической проверки."
    },
    {
      id: "gateway-primary-remarks",
      type: "exclusiveGateway",
      title: "Есть замечания к составу?",
      roleId: "gip-customer",
      x: 1080,
      y: 185,
      comment: "Если состав неполный или есть критичные замечания, согласование отклоняется и возвращается проектировщику."
    },
    {
      id: "reject-approval",
      type: "task",
      number: 2,
      title: "Отклонить согласование с комментарием",
      roleId: "gip-customer",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 1290,
      y: 55,
      comment: "ГИП отклоняет согласование соответствующей кнопкой и оставляет комментарий с причиной."
    },
    {
      id: "mail-rejected",
      type: "messageEvent",
      title: "Автоматическое письмо на почту",
      roleId: "system",
      x: 1640,
      y: 85,
      comment: "Sarex отправляет уведомление о завершении согласования со статусом «Отклонено»."
    },
    {
      id: "end-rejected",
      type: "endEvent",
      title: "Отклонено",
      roleId: "gip-customer",
      x: 1780,
      y: 85,
      comment: "Ветка завершена: согласование закрыто со статусом «Отклонено»."
    },
    {
      id: "finish-primary-check",
      type: "task",
      number: 2,
      title: "Завершить первичную проверку",
      roleId: "gip-customer",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 1290,
      y: 300,
      comment: "Если критичных замечаний нет, ГИП завершает свою проверку кнопкой «Завершить проверку» и оставляет комментарий для специалистов."
    },
    {
      id: "mail-to-specialists",
      type: "messageEvent",
      title: "Автоматическое письмо на почту",
      roleId: "system",
      x: 1640,
      y: 330,
      comment: "Sarex уведомляет проверяющих специалистов о передаче альбома на проверку."
    },
    {
      id: "gateway-parallel-split",
      type: "parallelGateway",
      title: "Параллельная проверка",
      roleId: "system",
      x: 1810,
      y: 315,
      comment: "Шлюз «И»: процесс запускает параллельные проверки несколькими специалистами."
    },
    {
      id: "specialist-review-subprocess",
      type: "subProcess",
      number: 3,
      title: "Параллельная проверка специалистами",
      roleId: "system",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 1985,
      y: 120,
      collapsedWidth: 300,
      collapsedHeight: 150,
      panelWidth: 720,
      panelHeight: 430,
      comment: "Свернутый подпроцесс объединяет параллельные проверки специалистов №1, №2 и №3. Нажмите на блок, чтобы раскрыть или свернуть детализацию."
    },
    {
      id: "review-s1",
      type: "task",
      parentId: "specialist-review-subprocess",
      number: 3,
      title: "Проверить альбом и приложить замечания",
      roleId: "specialist-1",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 2040,
      y: 170,
      comment: "Специалист №1 проверяет альбом и при необходимости публикует файл с замечаниями."
    },
    {
      id: "complete-s1",
      type: "task",
      parentId: "specialist-review-subprocess",
      number: 3,
      title: "Завершить этап проверки",
      roleId: "specialist-1",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 2370,
      y: 170,
      comment: "Специалист №1 завершает согласование на своём этапе и оставляет обязательный комментарий для ГИП."
    },
    {
      id: "review-s2",
      type: "task",
      parentId: "specialist-review-subprocess",
      number: 3,
      title: "Проверить альбом и приложить замечания",
      roleId: "specialist-2",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 2040,
      y: 365,
      comment: "Специалист №2 проверяет альбом и при необходимости публикует файл с замечаниями."
    },
    {
      id: "complete-s2",
      type: "task",
      parentId: "specialist-review-subprocess",
      number: 3,
      title: "Завершить этап проверки",
      roleId: "specialist-2",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 2370,
      y: 365,
      comment: "Специалист №2 завершает согласование на своём этапе и оставляет обязательный комментарий для ГИП."
    },
    {
      id: "review-s3",
      type: "task",
      parentId: "specialist-review-subprocess",
      number: 3,
      title: "Проверить альбом и приложить замечания",
      roleId: "specialist-3",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 2040,
      y: 560,
      comment: "Специалист №3 проверяет альбом и при необходимости публикует файл с замечаниями."
    },
    {
      id: "complete-s3",
      type: "task",
      parentId: "specialist-review-subprocess",
      number: 3,
      title: "Завершить этап проверки",
      roleId: "specialist-3",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "5 р.д.",
      x: 2370,
      y: 560,
      comment: "Специалист №3 завершает согласование на своём этапе и оставляет обязательный комментарий для ГИП."
    },
    {
      id: "gateway-parallel-join",
      type: "parallelGateway",
      title: "Все проверки завершены",
      roleId: "system",
      x: 2770,
      y: 365,
      comment: "Шлюз «И»: дальнейший этап начинается после завершения всех параллельных проверок."
    },
    {
      id: "mail-to-gip-after-review",
      type: "messageEvent",
      title: "Автоматическое письмо на почту",
      roleId: "system",
      x: 2950,
      y: 380,
      comment: "Sarex уведомляет ГИП о завершении проверок специалистами."
    },
    {
      id: "check-remarks",
      type: "task",
      number: 4,
      title: "Проверить наличие замечаний",
      roleId: "gip",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 3130,
      y: 350,
      comment: "ГИП проверяет альбом и результаты проверок специалистов на наличие замечаний."
    },
    {
      id: "gateway-has-remarks",
      type: "exclusiveGateway",
      title: "Есть замечания?",
      roleId: "gip",
      x: 3490,
      y: 360,
      comment: "При наличии замечаний выполняется аудит; при отсутствии замечаний документ получает статус «Согласовано»."
    },
    {
      id: "assign-approved",
      type: "task",
      number: 5,
      title: "Присвоить статус «Согласовано»",
      roleId: "gip",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 3710,
      y: 230,
      comment: "Если замечаний нет, ГИП присваивает документу статус «Согласовано»."
    },
    {
      id: "audit-remarks",
      type: "task",
      number: 4,
      title: "Провести аудит замечаний",
      roleId: "gip",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 3710,
      y: 475,
      comment: "ГИП консолидирует замечания и формирует единый итоговый файл."
    },
    {
      id: "create-remark",
      type: "task",
      number: 4,
      title: "Создать замечание к альбому",
      roleId: "gip",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 4040,
      y: 475,
      comment: "ГИП создаёт замечание к альбому, прикладывает файл с замечаниями и оставляет вложения."
    },
    {
      id: "assign-rejected",
      type: "task",
      number: 5,
      title: "Присвоить статус «Не согласовано»",
      roleId: "gip",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 4370,
      y: 475,
      comment: "После аудита замечаний ГИП присваивает документу статус «Не согласовано»."
    },
    {
      id: "gateway-final-status",
      type: "exclusiveGateway",
      title: "Итоговый статус",
      roleId: "gip",
      x: 4720,
      y: 360,
      comment: "Шлюз объединяет ветки согласованного и несогласованного исхода."
    },
    {
      id: "finish-approval",
      type: "task",
      number: 5,
      title: "Завершить согласование",
      roleId: "gip",
      document: "Разработанный альбом",
      system: "Sarex",
      deadline: "1 р.д.",
      x: 4930,
      y: 350,
      comment: "ГИП завершает согласование с помощью кнопки «Завершить согласование»."
    },
    {
      id: "mail-final",
      type: "messageEvent",
      title: "Автоматическое письмо на почту",
      roleId: "system",
      x: 5270,
      y: 380,
      comment: "Sarex отправляет автоматическое письмо о завершении согласования."
    },
    {
      id: "end-final",
      type: "endEvent",
      title: "Согласование завершено",
      roleId: "gip",
      x: 5410,
      y: 380,
      comment: "Процесс завершён с соответствующим итоговым статусом."
    }
  ],
  sequenceFlows: [
    { id: "f1", from: "start-album", to: "submit-route" },
    { id: "f2", from: "submit-route", to: "mail-to-gip" },
    { id: "f3", from: "mail-to-gip", to: "primary-check" },
    { id: "f4", from: "primary-check", to: "gateway-primary-remarks" },
    { id: "f5", from: "gateway-primary-remarks", to: "reject-approval", label: "да", condition: "reject" },
    { id: "f6", from: "reject-approval", to: "mail-rejected" },
    { id: "f7", from: "mail-rejected", to: "end-rejected" },
    { id: "f8", from: "gateway-primary-remarks", to: "finish-primary-check", label: "нет" },
    { id: "f9", from: "finish-primary-check", to: "mail-to-specialists" },
    { id: "f10", from: "mail-to-specialists", to: "gateway-parallel-split" },
    { id: "f11", from: "gateway-parallel-split", to: "specialist-review-subprocess" },
    { id: "f12", from: "specialist-review-subprocess", to: "gateway-parallel-join" },
    { id: "f13", from: "gateway-parallel-join", to: "mail-to-gip-after-review" },
    { id: "f14", from: "mail-to-gip-after-review", to: "check-remarks" },
    { id: "f15", from: "check-remarks", to: "gateway-has-remarks" },
    { id: "f16", from: "gateway-has-remarks", to: "assign-approved", label: "нет" },
    { id: "f17", from: "gateway-has-remarks", to: "audit-remarks", label: "да", condition: "remarks" },
    { id: "f18", from: "audit-remarks", to: "create-remark" },
    { id: "f19", from: "create-remark", to: "assign-rejected" },
    { id: "f20", from: "assign-approved", to: "gateway-final-status" },
    { id: "f21", from: "assign-rejected", to: "gateway-final-status" },
    { id: "f22", from: "gateway-final-status", to: "finish-approval" },
    { id: "f23", from: "finish-approval", to: "mail-final" },
    { id: "f24", from: "mail-final", to: "end-final" }
  ],
  subProcessFlows: [
    { id: "sf1", parentId: "specialist-review-subprocess", from: "review-s1", to: "complete-s1" },
    { id: "sf2", parentId: "specialist-review-subprocess", from: "review-s2", to: "complete-s2" },
    { id: "sf3", parentId: "specialist-review-subprocess", from: "review-s3", to: "complete-s3" }
  ]
};

const sizes = {
  task: { width: 245, height: 116 },
  startEvent: { width: 62, height: 62 },
  endEvent: { width: 62, height: 62 },
  messageEvent: { width: 62, height: 62 },
  exclusiveGateway: { width: 92, height: 92 },
  parallelGateway: { width: 92, height: 92 },
  subProcess: { width: 300, height: 150 }
};

const viewport = document.querySelector("#mapViewport");
const canvas = document.querySelector("#processCanvas");
const nodesLayer = document.querySelector("#processNodes");
const connections = document.querySelector("#connections");
const drawer = document.querySelector("#detailsDrawer");

const fields = {
  number: document.querySelector("#stepNumber"),
  title: document.querySelector("#stepTitle"),
  role: document.querySelector("#stepRole"),
  roleMeta: document.querySelector("#stepRoleMeta"),
  document: document.querySelector("#stepDocument"),
  system: document.querySelector("#stepSystem"),
  deadline: document.querySelector("#stepDeadline"),
  transition: document.querySelector("#stepTransition"),
  comment: document.querySelector("#stepComment")
};

let view = { x: 80, y: 70, scale: 0.36 };
let drag = null;
let pendingNodeClick = null;
const expandedSubProcesses = new Set();

function getNode(id) {
  return bpmnProcess.nodes.find((node) => node.id === id);
}

function getRole(roleId) {
  return bpmnProcess.roles.find((role) => role.id === roleId)?.title || roleId || "-";
}

function getSize(node) {
  if (node.type === "subProcess") {
    return { width: node.collapsedWidth, height: node.collapsedHeight };
  }

  return sizes[node.type];
}

function centerOf(node) {
  const size = getSize(node);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

function rightPort(node) {
  const size = getSize(node);
  return { x: node.x + size.width, y: node.y + size.height / 2, side: "right" };
}

function leftPort(node) {
  const size = getSize(node);
  return { x: node.x, y: node.y + size.height / 2, side: "left" };
}

function topPort(node) {
  const size = getSize(node);
  return { x: node.x + size.width / 2, y: node.y, side: "top" };
}

function bottomPort(node) {
  const size = getSize(node);
  return { x: node.x + size.width / 2, y: node.y + size.height, side: "bottom" };
}

function renderNodes() {
  nodesLayer.innerHTML = getVisibleNodes().map(renderNode).join("") + renderExpandedSubProcessPanels();
}

function getVisibleNodes() {
  return bpmnProcess.nodes.filter((node) => !node.parentId);
}

function renderNode(node) {
  if (node.type === "task") {
    return `
      <button class="process-node task-node" type="button" style="left: ${node.x}px; top: ${node.y}px" data-node="${node.id}">
        <span class="node-top">
          <span class="badge">${node.number}</span>
          <span class="deadline">${node.deadline}</span>
        </span>
        <strong class="node-title">${node.title}</strong>
        <span class="node-role">Роль: ${getRole(node.roleId)}</span>
      </button>
    `;
  }

  if (node.type === "subProcess") {
    const expanded = expandedSubProcesses.has(node.id);
    const size = getSize(node);
    return `
      <button
        class="process-node subprocess-node${expanded ? " expanded" : ""}"
        type="button"
        style="left: ${node.x}px; top: ${node.y}px; width: ${size.width}px; height: ${size.height}px"
        data-node="${node.id}"
        data-toggle-subprocess="true"
      >
        <span class="subprocess-head">
          <span class="badge">${node.number}</span>
          <span class="deadline">${node.deadline}</span>
        </span>
        <strong class="node-title">${node.title}</strong>
        <span class="node-role">Роль: ${getRole(node.roleId)}</span>
        <span class="subprocess-toggle">${expanded ? "Скрыть детали" : "Показать детали"}</span>
      </button>
    `;
  }

  if (node.type === "exclusiveGateway" || node.type === "parallelGateway") {
    const marker = node.type === "exclusiveGateway" ? "X" : "+";
    const gatewayClass = node.type === "exclusiveGateway" ? "exclusive-gateway" : "parallel-gateway";
    return `
      <button class="process-node gateway-node ${gatewayClass}" type="button" style="left: ${node.x}px; top: ${node.y}px" data-node="${node.id}">
        <span class="gateway-shape" aria-hidden="true"></span>
        <span class="gateway-marker" aria-hidden="true">${marker}</span>
        <span class="gateway-title">${node.title}</span>
      </button>
    `;
  }

  const eventClass = node.type === "startEvent" ? "start-event" : node.type === "endEvent" ? "end-event" : "message-event";
  const marker = node.type === "messageEvent" ? "✉" : "";
  return `
    <button class="process-node event-node ${eventClass}" type="button" style="left: ${node.x}px; top: ${node.y}px" data-node="${node.id}">
      <span class="event-marker">${marker}</span>
      <span class="event-title">${node.title}</span>
    </button>
  `;
}

function renderExpandedSubProcessPanels() {
  return [...expandedSubProcesses]
    .map((id) => {
      const parent = getNode(id);
      if (!parent) return "";

      const panelX = parent.x;
      const panelY = parent.y + parent.collapsedHeight + 58;
      const rows = getSubProcessRows(id)
        .map(
          (row) => `
            <div class="subprocess-row">
              ${renderSubProcessChild(row.review)}
              <span class="internal-arrow" aria-hidden="true"></span>
              ${renderSubProcessChild(row.complete)}
            </div>
          `
        )
        .join("");

      return `
        <section
          class="subprocess-panel"
          style="left: ${panelX}px; top: ${panelY}px; width: ${parent.panelWidth}px; min-height: ${parent.panelHeight}px"
          aria-label="Детализация подпроцесса ${parent.title}"
        >
          <div class="subprocess-panel-title">
            <span>${parent.title}</span>
            <small>детализация параллельных веток</small>
          </div>
          <div class="subprocess-rows">${rows}</div>
        </section>
      `;
    })
    .join("");
}

function getSubProcessRows(parentId) {
  const children = bpmnProcess.nodes.filter((node) => node.parentId === parentId);
  return [
    { review: children.find((node) => node.id === "review-s1"), complete: children.find((node) => node.id === "complete-s1") },
    { review: children.find((node) => node.id === "review-s2"), complete: children.find((node) => node.id === "complete-s2") },
    { review: children.find((node) => node.id === "review-s3"), complete: children.find((node) => node.id === "complete-s3") }
  ];
}

function renderSubProcessChild(node) {
  if (!node) return "";

  return `
    <button class="process-node subprocess-child" type="button" data-node="${node.id}">
      <span class="node-top">
        <span class="badge">${node.number}</span>
        <span class="deadline">${node.deadline}</span>
      </span>
      <strong class="node-title">${node.title}</strong>
      <span class="node-role">Роль: ${getRole(node.roleId)}</span>
    </button>
  `;
}

function renderConnections() {
  const marker = `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#7f929b"></path>
      </marker>
      <marker id="arrowWarn" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#a45f17"></path>
      </marker>
    </defs>
  `;

  connections.innerHTML = marker + getVisibleFlows().map(renderFlow).join("");
}

function getVisibleFlows() {
  return bpmnProcess.sequenceFlows;
}

function renderFlow(flow) {
  const from = getNode(flow.from);
  const to = getNode(flow.to);
  if (!from || !to) return "";
  const start = getFlowStart(from, to);
  const end = getFlowEnd(from, to);
  const warning = flow.condition === "reject" || flow.condition === "remarks";
  const d = buildPath(start, end);

  return `<path class="connector${warning ? " warn" : ""}" d="${d}" marker-end="url(#${warning ? "arrowWarn" : "arrow"})"></path>`;
}

function getFlowStart(from, to) {
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  if (Math.abs(fromCenter.x - toCenter.x) < 90) {
    return toCenter.y > fromCenter.y ? bottomPort(from) : topPort(from);
  }
  return toCenter.x >= fromCenter.x ? rightPort(from) : leftPort(from);
}

function getFlowEnd(from, to) {
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  if (Math.abs(fromCenter.x - toCenter.x) < 90) {
    return toCenter.y > fromCenter.y ? topPort(to) : bottomPort(to);
  }
  return toCenter.x >= fromCenter.x ? leftPort(to) : rightPort(to);
}

function buildPath(start, end) {
  const cleanStart = snapPoint(start);
  const cleanEnd = snapPoint(end);
  const dx = Math.abs(cleanEnd.x - cleanStart.x);
  const dy = Math.abs(cleanEnd.y - cleanStart.y);

  if (dy <= 8) {
    return `M ${cleanStart.x} ${cleanStart.y} L ${cleanEnd.x} ${cleanStart.y}`;
  }

  if (dx <= 8) {
    return `M ${cleanStart.x} ${cleanStart.y} L ${cleanStart.x} ${cleanEnd.y}`;
  }

  const exit = offsetFromSide(cleanStart, cleanStart.side, 36);
  const approach = offsetFromSide(cleanEnd, cleanEnd.side, 36);

  if (cleanStart.side === cleanEnd.side || isHorizontalSide(cleanStart.side) === isHorizontalSide(cleanEnd.side)) {
    if (isHorizontalSide(cleanEnd.side)) {
      const midX = Math.round((exit.x + approach.x) / 2);
      return toPath([cleanStart, exit, { x: midX, y: exit.y }, { x: midX, y: approach.y }, approach, cleanEnd]);
    }

    const midY = Math.round((exit.y + approach.y) / 2);
    return toPath([cleanStart, exit, { x: exit.x, y: midY }, { x: approach.x, y: midY }, approach, cleanEnd]);
  }

  const corner = isHorizontalSide(cleanStart.side)
    ? { x: approach.x, y: exit.y }
    : { x: exit.x, y: approach.y };

  return toPath([cleanStart, exit, corner, approach, cleanEnd]);
}

function snapPoint(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
    side: point.side
  };
}

function offsetFromSide(point, side, distance) {
  if (side === "right") return { x: point.x + distance, y: point.y };
  if (side === "left") return { x: point.x - distance, y: point.y };
  if (side === "bottom") return { x: point.x, y: point.y + distance };
  return { x: point.x, y: point.y - distance };
}

function isHorizontalSide(side) {
  return side === "left" || side === "right";
}

function toPath(points) {
  const compact = points.filter((point, index, list) => {
    if (index === 0) return true;
    const previous = list[index - 1];
    return point.x !== previous.x || point.y !== previous.y;
  });

  return compact.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function renderFlowLabels() {
  const labels = getVisibleFlows()
    .filter((flow) => flow.label)
    .map((flow) => {
      const position = getLabelPosition(flow);
      const warning = flow.condition === "reject" || flow.condition === "remarks";
      return `<span class="flow-label${warning ? " warn" : ""}" style="left: ${position.x}px; top: ${position.y}px">${flow.label}</span>`;
    })
    .join("");

  nodesLayer.insertAdjacentHTML("beforeend", labels);
}

function getLabelPosition(flow) {
  const from = centerOf(getNode(flow.from));
  const to = centerOf(getNode(flow.to));
  return {
    x: Math.round((from.x + to.x) / 2 - 24),
    y: Math.round((from.y + to.y) / 2 - 34)
  };
}

function applyView() {
  canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function resetView() {
  const rect = viewport.getBoundingClientRect();
  view = {
    x: rect.width < 900 ? 18 : 36,
    y: rect.height < 700 ? 28 : 54,
    scale: rect.width < 760 ? 0.22 : rect.width < 1200 ? 0.3 : 0.36
  };
  applyView();
}

function selectNode(id) {
  const node = getNode(id) || bpmnProcess.nodes[0];
  const visibleFlows = getVisibleFlows();
  const incoming = visibleFlows.filter((flow) => flow.to === node.id);
  const outgoing = visibleFlows.filter((flow) => flow.from === node.id);
  const role = getRole(node.roleId);

  fields.number.textContent = getNodeMarker(node);
  fields.title.textContent = node.title;
  fields.role.textContent = role;
  fields.roleMeta.textContent = role;
  fields.document.textContent = node.document || "-";
  fields.system.textContent = node.system || "-";
  fields.deadline.textContent = node.deadline || "-";
  fields.transition.textContent = formatTransitions(incoming, outgoing);
  fields.comment.textContent = node.comment || "Служебный BPMN-элемент процесса.";

  document.querySelectorAll(".process-node").forEach((element) => {
    element.classList.toggle("active", element.dataset.node === node.id);
  });

  drawer.classList.add("open");
}

function getNodeMarker(node) {
  if (node.number) return node.number;
  if (node.type === "startEvent") return "S";
  if (node.type === "endEvent") return "E";
  if (node.type === "messageEvent") return "M";
  if (node.type === "parallelGateway") return "+";
  if (node.type === "subProcess") return "SP";
  return "X";
}

function formatTransitions(incoming, outgoing) {
  const inText = incoming.length ? incoming.map((flow) => getNode(flow.from).title).join(", ") : "-";
  const outText = outgoing.length
    ? outgoing.map((flow) => `${flow.label ? `${flow.label}: ` : ""}${getNode(flow.to).title}`).join("; ")
    : "-";
  return `Вход: ${inText}. Выход: ${outText}.`;
}

function setScale(nextScale, originX, originY) {
  const scale = Math.min(1.15, Math.max(0.18, nextScale));
  const mapX = (originX - view.x) / view.scale;
  const mapY = (originY - view.y) / view.scale;
  view.x = originX - mapX * scale;
  view.y = originY - mapY * scale;
  view.scale = scale;
  applyView();
}

renderNodes();
renderConnections();
renderFlowLabels();
resetView();

document.querySelector("#closeDrawer").addEventListener("click", () => {
  drawer.classList.remove("open");
  document.querySelectorAll(".process-node").forEach((node) => node.classList.remove("active"));
});

document.querySelector("#resetView").addEventListener("click", resetView);
document.querySelector("#zoomIn").addEventListener("click", () => {
  const rect = viewport.getBoundingClientRect();
  setScale(view.scale + 0.08, rect.width / 2, rect.height / 2);
});
document.querySelector("#zoomOut").addEventListener("click", () => {
  const rect = viewport.getBoundingClientRect();
  setScale(view.scale - 0.08, rect.width / 2, rect.height / 2);
});

viewport.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const node = event.target.closest(".process-node");
  pendingNodeClick = node ? node.dataset.node : null;
  drag = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
  viewport.classList.add("dragging");
  viewport.setPointerCapture(event.pointerId);
});

viewport.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
  if (moved > 5) pendingNodeClick = null;
  view.x = drag.viewX + event.clientX - drag.x;
  view.y = drag.viewY + event.clientY - drag.y;
  applyView();
});

viewport.addEventListener("pointerup", (event) => {
  if (pendingNodeClick) {
    const node = getNode(pendingNodeClick);
    if (node?.type === "subProcess") {
      toggleSubProcess(node.id);
    }
    selectNode(pendingNodeClick);
  }
  pendingNodeClick = null;
  drag = null;
  viewport.classList.remove("dragging");
  if (viewport.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }
});

viewport.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const next = view.scale + (event.deltaY > 0 ? -0.06 : 0.06);
    setScale(next, event.clientX - rect.left, event.clientY - rect.top);
  },
  { passive: false }
);

window.addEventListener("resize", resetView);

function toggleSubProcess(id) {
  if (expandedSubProcesses.has(id)) {
    expandedSubProcesses.delete(id);
  } else {
    expandedSubProcesses.add(id);
  }

  renderNodes();
}
