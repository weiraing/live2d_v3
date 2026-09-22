  'use strict';

  var STORAGE_KEY = 'l2d-viewer-state-v1';
  // GitHub 仓库地址。默认值用于本地预览（本地无法从域名推断仓库），
  // 部署在 *.github.io 上时会自动按当前地址推断出真实仓库。
  var REPO_URL = 'https://github.com/weiraing/live2d_v3';

  // ==================================================================
  // 模型资源基址：页面与模型**分开存放**
  //
  // 页面发布到 gh-pages 分支（几百 KB），模型留在 master 分支（几百 MB）。
  // 这样「新增一个模型 / 刷新一次 models.json」只需要动 master，gh-pages 那侧
  // 是零改动 —— 不必重新生成、同步一份几百兆的站点产物（这正是以前慢的原因：
  // 提交一个 20KB 的 models.json，GitHub 也得把整站 263MB 重新构建一遍）。
  //
  // 代价：页面在 gh-pages 上，模型在 master 上，必须走**绝对地址**（跨分支）。
  // 本地开发（http://localhost）时模型就在旁边，继续走相对路径，免得白绕一圈网络。
  //
  // 源策略（2026-09-23 rain 拍板，**不用 jsDelivr 了**）：
  //   · 默认 —— raw.githubusercontent.com，GitHub 官方原始地址
  //   · 兜底 —— 一个「加速地址」。所谓加速地址是个**前缀代理**：
  //               加速地址 + 原始 GitHub 绝对地址
  //             例：https://gh-proxy.org/https://raw.githubusercontent.com/o/r/master/x
  //             （ghproxy 系站点的通行形态；用户自己再拼一层路径，所以这里只做前缀拼接）
  //
  // ⚠️ 不再有「raw / cdn 二选一」的语义。列表里显示的是「GitHub 原始地址」或
  //    该加速站的域名，区分靠 S_baseName（'github' / 'accel' / 'local'）。
  //
  // ⚠️ 改仓库名 / 用户名只改下面两行。
  var REPO_OWNER = 'weiraing';
  var REPO_NAME  = 'live2d_v3';

  // 默认分支候选：GitHub 新建仓库默认 main，老仓库多是 master。**两个都试一遍**，
  // 谁先取到 models.json 就用谁 —— 不必让人先自己去确认「这个仓库的分支叫啥」。
  // 探明之后候选表会收窄成「同一分支的原始地址 + 加速地址」（见 pinBranch）。
  var BRANCHES = ['master', 'main'];

  function rawBaseOf(branch) {
    return 'https://raw.githubusercontent.com/' + REPO_OWNER + '/' + REPO_NAME + '/' + branch + '/';
  }

  // ---------- 加速地址（前缀代理） ----------
  //
  // ⚠️⚠️ 加速地址是**前缀**，不是替换域名：
  //        https://<加速站>/https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
  //    所以「拼一个加速后的地址」就是把两个绝对地址直接粘起来 —— 不需要解析加速站自己的
  //    路径规则（各家不一样，猜错就 404）。代价是地址变长，但这是唯一能通吃的做法。
  //
  // ⚠️ 规范化时**必须保留协议**（https:// 不能省）：站点收到的就是一条完整 URL，
  //    省掉协议它不知道往哪转发。这点与「替换域名型」代理正好相反。
  function normalizeAccelBase(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;   // 只写了域名时补协议，别让用户被这点小事卡住
    try {
      var u = new URL(s);
      if (!u.hostname) return '';
      // 只留协议 + 主机（丢查询串/锚点；路径保留，有的加速站部署在子路径下）
      var path = u.pathname.replace(/\/+$/, '');       // 尾部多余斜杠去掉，拼接时统一补一个
      return u.protocol + '//' + u.host + path + '/';
    } catch (e) { return ''; }
  }

  // 加速地址 → 域名（列表标签、预览用）。取不出来就回退原文。
  function accelLabel(base) {
    var n = normalizeAccelBase(base);
    if (!n) return '';
    try { return new URL(n).hostname; } catch (e) { return n; }
  }

  // 把一份「原始 GitHub 绝对地址」套上加速前缀
  function accelerate(rawUrl, accelBase) {
    var a = normalizeAccelBase(accelBase);
    if (!a) return rawUrl;
    return a + rawUrl;
  }

  // 内置常用加速站（都是「前缀代理」形态，rain 2026-09-23 给的清单）。
  // ⚠️ 这些是**第三方公益服务**，随时可能停服 / 改规则 / 限速 —— 所以：
  //    · 列表里带 site 字段落进 localStorage 时只存**地址**，不存「站点可用」这个结论；
  //    · 每次真请求失败都能让用户换一个（见弹窗里的下拉）；
  //    · 新增站点只改这个数组，别把判断散到别的函数里。
  var ACCEL_PRESETS = [
    { label: 'gh-proxy.org',           base: 'https://gh-proxy.org/' },
    { label: 'ghproxy.net',            base: 'https://ghproxy.net/' },
    { label: 'github.dpik.top',        base: 'https://github.dpik.top/' },
    { label: 'gh.dpik.top',            base: 'https://gh.dpik.top/' },
    { label: 'ghfile.geekertao.top',   base: 'https://ghfile.geekertao.top/' },
    { label: 'github.tbap.top',        base: 'https://github.tbap.top/' },
    { label: 'ghf.无名氏.top',          base: 'https://ghf.无名氏.top/' },
    { label: 'gh.927223.xyz',          base: 'https://gh.927223.xyz/' }
  ];

  // 当前生效的模型基址（末尾一定带 '/'；本机相对模式时是空串）
  var S_modelsBase = '';
  // 外部基址的候选顺序（主 → 备）。探测阶段含两个分支，探明后只剩同一分支的两项。
  var S_baseCandidates = [];
  // ?src= 强制指定的源（'' = 不强制）。收窄候选表时要照它来。
  //   'github' —— 只用原始地址
  //   'accel'  —— 只用加速地址
  var S_forcedSrc = '';
  // 加速模式时，兜底用哪个加速地址（空 = 不兜底）。由偏好里「上次选的那个」决定。
  // ⚠️ 启动时会用 initAccelBase() 落一个默认值（内置第一个 / 上次选的），
  //    **不能留着空串** —— 空串的话候选表里根本没有加速项，
  //    「raw 拉不到 → 自动切加速」的兜底就是一句空话（探针 B/F 组的靶子）。
  var S_accelBase = '';
  // base 串 → 分支名。候选表都是这里拼的，留个映射比事后用正则从 URL 里抠分支可靠
  // （分支名本身可能带 '.' / '-'，正则容易误伤）。
  var S_branchByBase = {};

  // 是不是「页面与模型分离」的部署形态：
  //   · 本机 localhost / 127.0.0.1 / file:// → 否，走相对路径（模型就在页面旁边）
  //   · 其余（GitHub Pages、自定义域名）→ 是，走 raw / 加速 两个绝对基址
  // 用「同源探测」比猜域名可靠：本地起 http.server 时，models/ 就在同目录下。
  function isLocalHost() {
    var h = location.hostname;
    return !h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  }

  // 决定「兜底用哪个加速地址」。
  //   · ?src=accel&accel=<地址> 显式指定 → 用它（便于分享一条固定走某加速站的链接）
  //   · 否则用**上次在弹窗里选过的那个**（localStorage）
  //   · 都没选过 → 内置清单第一个
  // ⚠️ 只影响「兜底」—— 主源永远是 GitHub 原始地址（除非 ?src=accel 强制）。
  //    所以这里读到什么，都不会让页面默认去走第三方。
  function initAccelBase() {
    var forced = '';
    try { forced = new URLSearchParams(location.search).get('accel') || ''; } catch (e) {}
    var pref = loadExtSrcPref();
    var pick = forced || pref.accel || pref.customAccel || '';
    var n = normalizeAccelBase(pick);
    if (!n) n = normalizeAccelBase(ACCEL_PRESETS[0] && ACCEL_PRESETS[0].base);
    S_accelBase = n || '';
    return S_accelBase;
  }

  // 解析出本次要用的基址候选表（主→备）。返回空数组 = 本机相对模式。
  //
  // ⚠️ 顺序是「源在外层、分支在内层」：命中 master 时零浪费（第一个就中）；而
  //    主源不可用时紧接着试的是同源的 main 分支而不是另一个源，于是「探明分支」
  //    的那次成功一定落在**第一个源**上，收窄后的候选表天然就是 [主, 备] 两项。
  //    反过来排（分支在外层）会让主源挂掉时那唯一一次重试撞到备源@master 的 404。
  //
  // ⚠️ 默认「GitHub 原始地址主、加速地址备」（2026-09-23 rain 要求）：
  //    raw 是国内访问的老大难（慢 + 批量请求 429），所以给一个加速兜底；
  //    但**默认不主动用第三方**，只有 raw 真拉不到时才切过去。
  //    加速站由使用者自己在下拉里选（存 localStorage），没选过就直接用内置第一个。
  function buildBaseCandidates() {
    if (isLocalHost()) return [];
    initAccelBase();
    var q = '';
    try { q = (new URLSearchParams(location.search).get('src') || '').toLowerCase(); } catch (e) {}
    // 兼容老写法：?src=raw 等同 github，?src=cdn 在 jsDelivr 下线后无意义 → 当作默认
    if (q === 'raw' || q === 'github') S_forcedSrc = 'github';
    else if (q === 'accel' || q === 'cdn') S_forcedSrc = 'accel';
    else S_forcedSrc = '';

    var out = [];
    function addRaw() {
      BRANCHES.forEach(function (b) {
        var base = rawBaseOf(b);
        S_branchByBase[base] = b;
        out.push(base);
      });
    }
    function addAccel() {
      if (!S_accelBase) return;
      BRANCHES.forEach(function (b) {
        var raw = rawBaseOf(b);
        var base = accelerate(raw, S_accelBase);
        S_branchByBase[base] = b;
        out.push(base);
      });
    }

    if (S_forcedSrc === 'github') { addRaw(); return out; }
    if (S_forcedSrc === 'accel') { addAccel(); return out; }
    addRaw(); addAccel();          // 默认 github 主、加速备
    return out;
  }

  // 把仓库内的相对路径（如 'models/Azue Lane(JP)/x/x.model3.json'）拼成可请求的 URL。
  // 本机相对模式下原样返回，外部基址下补上绝对前缀。
  // ⚠️ 逐段 encodeURIComponent：模型目录名里大量空格、括号、中文、日文
  //    （'Azue Lane(JP)'、'Celeste - free'、'用户上传'），不编码的话
  //    空格会被当成 URL 结束、括号会被当成语法，raw/CDN 直接 404。
  // ⚠️ 但**不能**对整串 encodeURI —— 那会把 '/' 也编成 %2F，路径就断了。
  function encodeRepoPath(rel) {
    return String(rel == null ? '' : rel).split('/').map(encodeURIComponent).join('/');
  }

  function modelsUrl(rel) {
    if (!S_modelsBase) return rel;
    return S_modelsBase + encodeRepoPath(rel);
  }

  var els = {
    modelList:    document.getElementById('modelList'),
    modelCount:   document.getElementById('modelCount'),
    modelSearch:  document.getElementById('modelSearch'),
    host:         document.getElementById('live2d-canvas-host'),
    stage:        document.getElementById('stage'),
    overlay:      document.getElementById('overlay'),
    ovSpinner:    document.getElementById('ovSpinner'),
    ovMsg:        document.getElementById('ovMsg'),
    ovDetail:     document.getElementById('ovDetail'),
    badge:        document.getElementById('badge'),
    badgeName:    document.getElementById('badgeName'),
    badgeMotion:  document.getElementById('badgeMotion'),
    btnPlay:      document.getElementById('btnPlay'),
    icoPlay:      document.getElementById('icoPlay'),
    icoPause:     document.getElementById('icoPause'),
    speed:        document.getElementById('speed'),
    speedVal:     document.getElementById('speedVal'),
    checkerBg:    document.getElementById('checkerBg'),
    btnReset:     document.getElementById('btnReset'),
    btnClearCache: document.getElementById('btnClearCache'),
    stageSeg:     document.getElementById('stageSeg'),
    stageSegBtn:  document.getElementById('stageSegBtn'),
    stageSegDot:  document.getElementById('stageSegDot'),
    stageSegLabel:document.getElementById('stageSegLabel'),
    stageSegList: document.getElementById('stageSegList'),
    btnFull:      document.getElementById('btnFull'),
    btnDownload:  document.getElementById('btnDownload'),
    listLoop:     document.getElementById('listLoop'),
    soundEnabled: document.getElementById('soundEnabled'),
    btnExitFs:    document.getElementById('btnExitFs'),
    ghLink:       document.getElementById('ghLink'),
    stageHint:    document.getElementById('stageHint'),
    btnNav:       document.getElementById('btnNav'),
    btnNavClose:  document.getElementById('btnNavClose'),
    btnNavPin:    document.getElementById('btnNavPin'),
    navScrim:     document.getElementById('navScrim'),
    btnLocal:     document.getElementById('btnLocal'),
    btnLocalText: document.getElementById('btnLocalText'),
    fileLocal:    document.getElementById('fileLocal'),
    localModal:   document.getElementById('localModal'),
    localMask:    document.getElementById('localMask'),
    localDrop:    document.getElementById('localDrop'),
    localClose:   document.getElementById('btnLocalClose'),
    localStatus:  document.getElementById('localStatus'),
    localStatusText: document.getElementById('localStatusText'),
    localErr:     document.getElementById('localErr'),
    toastHost:    document.getElementById('toastHost'),

    // 贡献模型
    btnContrib:      document.getElementById('btnContrib'),
    btnContribText:  document.getElementById('btnContribText'),
    contribModal:    document.getElementById('contribModal'),
    contribMask:     document.getElementById('contribMask'),
    btnContribClose:  document.getElementById('btnContribClose'),
    contribPick:     document.getElementById('contribPick'),
    contribPath:     document.getElementById('contribPath'),
    contribCount:    document.getElementById('contribCount'),
    contribFiles:    document.getElementById('contribFiles'),
    contribRepo:     document.getElementById('contribRepo'),
    contribRepoAuto: document.getElementById('contribRepoAuto'),
    contribRepoHint: document.getElementById('contribRepoHint'),
    contribToken:    document.getElementById('contribToken'),
    contribRemember: document.getElementById('contribRemember'),
    btnContribForget: document.getElementById('btnContribForget'),
    contribStatus:   document.getElementById('contribStatus'),
    contribStatusText: document.getElementById('contribStatusText'),
    contribErr:      document.getElementById('contribErr'),
    btnContribGo:    document.getElementById('btnContribGo'),
    btnContribCancel: document.getElementById('btnContribCancel'),

    // 部件面板（右抽屉）
    rightPane:       document.getElementById('rightPane'),
    btnPartsFab:     document.getElementById('btnPartsFab'),
    partsFabDot:     document.getElementById('partsFabDot'),
    btnRightClose:   document.getElementById('btnRightClose'),
    partsSearch:     document.getElementById('partsSearch'),
    partsExpand:     document.getElementById('partsExpand'),
    partsCollapse:   document.getElementById('partsCollapse'),
    partsTree:       document.getElementById('partsTree'),
    tabParts:        document.getElementById('tabParts'),
    tabInfo:         document.getElementById('tabInfo'),
    rightInfo:       document.getElementById('rightInfo'),
    rightNote:       document.getElementById('rightNote'),
    btnClearOverrides: document.getElementById('btnClearOverrides'),
    btnExportShot:   document.getElementById('btnExportShot'),
    btnExportConfig: document.getElementById('btnExportConfig'),

    // 添加外部模型源
    btnAddSrc:       document.getElementById('btnAddSrc'),
    srcModal:        document.getElementById('srcModal'),
    srcMask:         document.getElementById('srcMask'),
    srcClose:        document.getElementById('btnSrcClose'),
    srcUrl:          document.getElementById('srcUrl'),
    srcKind:         document.getElementById('srcKind'),
    srcAccelRow:     document.getElementById('srcAccelRow'),
    srcAccelInput:   document.getElementById('srcAccelInput'),
    srcRepo:         document.getElementById('srcRepo'),
    srcBranch:       document.getElementById('srcBranch'),
    srcEffective:    document.getElementById('srcEffective'),
    srcPreview:      document.getElementById('srcPreview'),
    srcStatus:       document.getElementById('srcStatus'),
    srcStatusText:   document.getElementById('srcStatusText'),
    srcErr:          document.getElementById('srcErr'),
    btnSrcGo:        document.getElementById('btnSrcGo'),
    btnSrcCancel:    document.getElementById('btnSrcCancel')
  };
  var appEl = document.querySelector('.app');

  // ---------- 状态 ----------
  var S = {
    models: [],          // 发现的模型清单
    model: null,         // 当前模型
    motions: [],         // 当前模型的动作文件列表
    current: -1,         // 当前动作索引
    source: '',          // 模型清单来源：github / index / fallback
    collapsed: {},       // 分组折叠状态：true=折叠 / false=展开 / 没这个键=折叠（默认不展开）
    _revealedOnce: false,// revealActiveModel() 是否已经跑过一次（见该函数里的说明）
    app: null,
    l2dModel: null,
    playing: false,
    speed: 1,
    motionClock: 0,      // 自维护的动作时间轴（秒），见 tickProgress
    holdTime: 0,         // 动作播完后定格的时间点
    pausedEntry: null,   // 暂停/定格时挂在队列里的那一项（只挂一次，避免每帧重入队导致抖动）
    finished: false,     // 当前定格是不是「自然播完」造成的（据此决定按播放是重播还是续播）
    view: { x: 0, y: 0, scale: 1 },
    dragging: false,
    dragStart: null,
    wire: null,          // 网格容器
    checkerOn: true,     // 棋盘底：舞台背景换成棋盘格（看透明 / 半透明边缘用）。
                         // ⚠️ 默认**开**（2026-09-23 rain 要求）—— 与 `#checkerBg` 的
                         //    HTML `checked` 属性、以及下面 localStorage 缺省分支三处必须一致，
                         //    漏一处就会出现「复选框打着勾但舞台不画棋盘」这种半生效状态。
    busyModel: false,
    pendingModel: null,  // 载入中又点了别的模型时暂存下来，载完再切过去
    autoPlayAll: false,  // 「列表循环」开关。这里的「列表」指的是**模型列表**（侧栏那个）：
                         //   开 → 当前模型全部动作播完后，自动切到列表里的下一个模型，
                         //        到列表末尾绕回第一个，一直轮播下去
                         //   关 → 只在本模型内循环动作，永远不切模型
                         // 默认关 —— 不少用户只想盯着一个角色翻动作看，要切再自己开。
    _skipCount: 0,       // 连续跳过了几个「一个动作都没有」的模型（见 tickSkipMotionless）
    _skipAt: 0,          // 上次跳过的时刻，用来限速，避免在 tick 里连跳
    downloading: false,  // 「下载模型」打包中，防止连点
    fullscreen: false,   // 是否处于「全屏只显示模型」模式
    stageTheme: 'dark', // 舞台背景：'light' | 'dark' | 'black'
    primed: false,       // 动作队列是否已由 playMotion 初始化好（见 tickProgress 开头）
    navOpen: true,        // 桌面端默认展开侧栏，手机端在 boot() 中重置为 false
    navPinned: false,     // 「固定」开关：钉上后悬停自动展开/折叠失效，只由展开/收起按钮控制
    uploading: false,    // 「本地预览」正在处理压缩包，防止连点
    localOpen: false,    // 「本地预览」对话框是否打开（决定 Esc 先关对话框而不是退全屏）
    contribOpen: false,  // 「贡献模型」对话框是否打开（同样参与 Esc 优先级）
    srcOpen: false,      // 「添加外部模型源」对话框是否打开（Esc 优先级中的一个）
    contributing: false, // 正在往仓库上传，防连点
    soundEnabled: true,  // 动作语音开关（默认开启）
    _baseUrl: '',        // 当前模型的目录基础路径，用于解析语音文件的绝对地址
    _curAudio: null,     // 当前正在播放的 Audio 元素（切换动作时需先停掉）
    _deadUrls: [],        // 待释放的 object URL（模型卸载之后再 revoke，见 queueRevoke）
    _advancing: false,    // 动作切换防重入闸（advanceToMotion 置 true，450ms 后复位）
    _firstLoad: true,    // 首次载入标记：首次暂停，之后切换自动播放
    rightPaneOpen: false,// 右侧抽屉（部件面板）开关
    // 部件面板的临时覆盖（切模型时被 resetPartsPanel 一次性清空，仅当前会话生效）。
    _parts: [],          // 节点：{ i, name, parent, kids, depth, nd }
    _partsOrder: [],     // DFS 顺序
    _partsCollapsed: {}, // partIndex -> true
    _partsDrawOf: {},    // partIndex -> [drawableIndex]
    _partsBaseOp: {},    // partIndex -> 「模型自己给的不透明度」（载入时捕获一次）
    _partOp: {},         // partIndex -> 覆盖值（0..1）
    _drawHide: {},       // drawableIndex -> true（清 dynamicFlags bit0）
    _partSolo: -1,       // 正在 solo 的部件；-1 = 无
    _partSoloBackup: null,
    _partsFilter: ''     // 搜索关键字
  };

  // ⚠️⚠️ GitHub 令牌刻意**不放进 S**：S 会被 saveState() 整个序列化进 localStorage，
  //    放进去就等于把令牌写进磁盘存档。它只活在这个变量里（刷新即失效），
  //    用户勾了「记住」才单独写 CONTRIB_TOKEN_KEY，并且随时可以点按钮清掉。
  var contribTokenMem = '';
  var CONTRIB_TOKEN_KEY = 'l2d-contrib-token';   // 只存令牌本身，与其它设置分开
  var CONTRIB_REPO_KEY  = 'l2d-contrib-repo';    // 手填的「用户名/仓库名」，下次打开时回填
  var CONTRIB_DIR = '用户上传';                   // models/<CONTRIB_DIR>/<模型名>/…

  // 上次填过的外部源链接，下次打开对话框时预填。
  // ⚠️ 与令牌同理，它**不进 S**（S 会被 saveState() 整个序列化）—— 但和令牌不同的是
  //    这里没有任何凭据，只是一条公开的 models.json 地址，存下来没有风险。
  var EXTSRC_KEY = 'l2d-extsrc';

  // ---------- 工具 ----------
  function prettyName(base) {
    var n = String(base).replace(/\.motion3\.json$/i, '').replace(/-/g, '_');
    return n.split('_').map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  function modelTitle(m) {
    return m ? m.name : '';
  }

  function showOverlay(msg, detail, isError, spinning) {
    els.overlay.classList.remove('hide');
    els.overlay.classList.toggle('error', !!isError);
    els.ovSpinner.style.display = spinning === false ? 'none' : '';
    els.ovMsg.textContent = msg || '';
    els.ovDetail.textContent = detail || '';
  }
  function hideOverlay() { els.overlay.classList.add('hide'); }

  // 打开对话框之前把手机端的侧栏抽屉收起来。
  //
  // ⚠️ 为什么需要：三个对话框（本地预览 / 贡献模型 / 添加外部源）都挂在 .stage 里，
  //    z-index 只有 8；而手机端的侧栏是 position:fixed 的抽屉，z-index 40 ——
  //    抽屉不收，84vw 宽的对话框会被压在底下，用户只看得到右边一条缝，
  //    想点对话框还会先点到抽屉遮罩上（于是变成「关抽屉」而不是操作对话框）。
  //    桌面端侧栏在文档流里、不压舞台，对话框居中显示本来就没这问题，
  //    所以只在手机断点下动。
  function closeNavForDialog() {
    if (mqMobile.matches && S.navOpen) setNav(false);
  }

  function saveState() {
    try {
      // ⚠️ 外部模型的 key 落盘没意义 —— 外部源不进 localStorage，
      // 下次打开就找不到这个 key；不写出去反而干净。
      var m = (S.model && !S.model._external) ? S.model.key : null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        model: m,
        stage: S.stageTheme,
        speed: S.speed,
        listLoop: S.autoPlayAll,
        soundEnabled: S.soundEnabled,
        checkerBg: S.checkerOn,
        collapsed: S.collapsed,
        navPinned: !!S.navPinned
      }));
    } catch (e) { /* 忽略隐私模式下的写入失败 */ }
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; }
  }

  // ?model=<path/file> 直接指定要打开的模型，方便把某个模型的预览链接分享出去。
  // 也接受 ?model=<模型目录名>，会取该目录下的第一个模型。
  function wantModelFromURL() {
    var want = '';
    try { want = new URLSearchParams(location.search).get('model') || ''; } catch (e) { want = ''; }
    if (!want) return '';
    want = want.replace(/^\/+|\/+$/g, '');
    for (var i = 0; i < S.models.length; i++) if (S.models[i].key === want) return want;
    // 退一步：按目录名 / 模型名匹配
    for (var j = 0; j < S.models.length; j++) {
      if (S.models[j].path === want || S.models[j].name === want) return S.models[j].key;
    }
    return '';
  }

  // ---------- 1. 发现模型 ----------
  // 两级降级：
  //   A. models.json（仓库根目录，由 models_tool.py 生成；直接读文件，不限流、任意托管、离线可用）
  //   B. 内置兜底清单（A 不可用时仍能跑）
  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  // 按候选基址依次尝试（主 → 备），第一个成功的胜出并把 S_modelsBase 钉在它上面。
  // make(rel) 负责把「仓库内相对路径」转成这次要请求的 URL —— 这样调用方
  // 只需要给出 'models.json' 这种仓库内路径，不必关心当前用的是 raw 还是 CDN。
  // 本机相对模式（S_baseCandidates 为空）时只试一次。
  function fetchWithFallback(make, rel) {
    var cands = S_baseCandidates.length ? S_baseCandidates : [''];
    var lastErr = null;
    function attempt(i) {
      if (i >= cands.length) throw (lastErr || new Error('没有可用的模型来源'));
      var base = cands[i];
      return make(base, rel).then(function (v) {
        if (S_modelsBase !== base) { S_modelsBase = base; S_baseName = baseName(base); }
        pinBranch(base);
        return v;
      }, function (e) {
        lastErr = e;
        if (i + 1 < cands.length) {
          console.warn('[viewer] 模型源不可用，切换备用源：' + base, e && e.message);
        }
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  // 给一个基址起个「来源名」—— 只用来显示与断言，不参与任何判定逻辑。
  //   local  —— 本机同源（相对路径）
  //   github —— 原始地址（raw.githubusercontent.com 开头）
  //   accel  —— 加速地址（其它一切，因为加速站是用户自填的，认不出「是哪家」）
  function baseName(base) {
    if (!base) return 'local';
    return /^https?:\/\/raw\.githubusercontent\.com\//i.test(base) ? 'github' : 'accel';
  }
  var S_baseName = 'local';

  // 按当前（或候选）基址取一个仓库内文件
  function fetchRepoJSON(rel) {
    return fetchWithFallback(function (base, r) {
      return fetchJSON(base ? (base + encodeRepoPath(r)) : r);
    }, rel);
  }

  // 切到下一个候选源。返回 true = 真的切过去了。
  //
  // ⚠️ 为什么需要它：上面的 `fetchWithFallback` 只在**读 models.json 时**探源 ——
  //    一个文件探不出「源半死」：raw.githubusercontent.com 在批量请求下会限速（429），
  //    加速站也可能整段抽风，完全可能「models.json（20KB，一个请求）取得到，
  //    而模型的几十个文件全取不到」。实测（探针 F 组）：这种情况下列表能列出来全部模型，
  //    但**每一个都载入失败**，而且永远死钉在当前源上、不会自己去用另一个源 —— 页面看着像坏了。
  //    所以模型资源失败时要能再切一次。
  //
  // ⚠️⚠️ 切过去之后**必须把新源提到候选表第一位**（`promoteModelsBase`）——
  //    否则会出现「S_modelsBase 已经是加速、cands[0] 还是 raw」这种表里不一，
  //    下一次点模型时 `fetchWithFallback` 又从 cands[0] 的 raw 试起。见 promoteModelsBase。
  function advanceModelsBase() {
    if (!S_baseCandidates.length) return false;        // 本机同源模式，没别的可切
    var i = S_baseCandidates.indexOf(S_modelsBase);
    if (i < 0) i = 0;
    if (i + 1 >= S_baseCandidates.length) return false; // 已经是最后一个候选
    S_modelsBase = S_baseCandidates[i + 1];
    S_baseName = baseName(S_modelsBase);
    // ⚠️ 顺手把新源提到最前 —— 否则候选表与「当前生效源」失配（见函数上方说明）
    promoteModelsBase(S_modelsBase);
    console.warn('[viewer] 模型资源取不到，切到备用源：' + S_modelsBase);
    return true;
  }

  // 把某个已在候选表里的基址**提到第一位**，让「cands[0] === 当前生效源」永远成立。
  //
  // ⚠️⚠️ 为什么需要这个不变量：`fetchWithFallback` 是**按 cands 的顺序**依次试的
  //    （`attempt(0)` 先打 cands[0]）。而模型文件的载入走的是 `fetchJSON(manifestUrl)`
  //    —— **完全不经过 fetchWithFallback**，也就是说走 `modelsUrl()` 拼出来的
  //    `S_modelsBase`。两条路径对「当前该用哪个源」的判断必须一致：
  //      · 拼 URL（modelsUrl）    → 读 S_modelsBase
  //      · 读清单（fetchWithFallback）→ 读 cands[0]
  //    一旦 S_modelsBase 被 advanceModelsBase 换成备源、而 cands 没跟着调序，
  //    两者就分叉了：**清单走加速、模型文件却还从 raw 试起**。
  //    症状（rain 2026-09-23 反馈）：弹窗里明明选了加速，点模型时第一跳仍打 raw。
  //
  // 返回是否真的动过顺序。
  function promoteModelsBase(base) {
    if (!base || !S_baseCandidates.length) return false;
    var i = S_baseCandidates.indexOf(base);
    if (i <= 0) return false;                          // 不在表里 / 本来就在第一位
    S_baseCandidates.splice(i, 1);
    S_baseCandidates.unshift(base);
    return true;
  }

  // 分支探明之后，把候选表收窄成「同一分支的原始地址 + 加速地址」。
  //
  // ⚠️⚠️ 为什么必须收窄：switchModel 载入失败时，每个模型**只给一次**换源重试
  //    （m._srcRetried 守卫）。若候选表一直留着 4 项，主源挂掉时那唯一一次重试
  //    会撞到同源的 main 分支 —— 同样不可用 —— 于是直接放弃，反而比改造前
  //    更差（那时下一项就是另一个源）。收窄之后「重试一次 = 换一个源」，
  //    语义与改造前完全一致。
  function pinBranch(base) {
    var br = S_branchByBase[base];
    if (!br) return;
    var raw = rawBaseOf(br);
    if (S_forcedSrc === 'github') { S_baseCandidates = [raw]; return; }
    if (S_forcedSrc === 'accel') {
      var only = accelerate(raw, S_accelBase);
      S_baseCandidates = [only];
      return;
    }
    var acc = S_accelBase ? [accelerate(raw, S_accelBase)] : [];
    // 主源到底是哪个：刚成功的那次若落在加速地址上（说明 raw 先失败了），
    // 收窄后要让加速地址排前面，否则下一次 advanceModelsBase 会又切回挂掉的 raw。
    var accelFirst = !!S_accelBase && /^https?:\/\/raw\.githubusercontent\.com\//i.test(base) === false;
    S_baseCandidates = accelFirst ? acc.concat([raw]) : [raw].concat(acc);
  }

  // 用户在弹窗里换了「数据源」之后，把当前生效的基址**原地换到新源**上去。
  //
  // ⚠️⚠️ 为什么需要它：S_modelsBase 只在 boot 时钉一次（buildBaseCandidates()[0]），
  //    之后切换数据源**不会**重钉它 —— 于是出现「在弹窗里把源选成加速站，
  //    回到左侧列表点模型，还是从 raw.githubusercontent.com 取」这种前后矛盾的体验
  //    （rain 2026-09-23 反馈）。这个函数把那条线接上。
  //
  // 做法是「换前缀、保分支」：
  //   · 分支从当前 S_modelsBase 反查（S_branchByBase），不是从 BRANCHES[0] 猜 ——
  //     当前源可能已经因为兜底/分支回退落到了 main 上，换源时把它保住。
  //   · force = 'accel' 并且给了 accelBase → 拼到**那个站**上（见下面的 whyBase）。
  //   · force = 'github' → 剥掉加速前缀回到 raw。
  //   · **已经是加速态时再换另一个站也要真的换过去** —— 因为调用方已经保证了
  //     「这是用户确认过的意图」。旧版本这里有个 `if (isAccel) return false;` 守卫，
  //     那是「下拉一 change 就生效」时代的产物（分不清「真想换」和「点着看看」，
  //     所以保守不动）；现在有了确认这一关，再留着它就会让「选了也确认了却什么都没变」。
  //
  // ⚠️ 候选表要跟着重建（pinBranch），否则下次 advanceModelsBase 会从「旧源的老顺序」
  //    里挑下一项，等于把刚换过去的源又切回来。
  // ⚠️ 本机同源模式（候选表为空）什么都不做 —— 模型就在页面旁边，没「源」可换。
  //
  // ⚠️⚠️ 参数 whyBase（**用户在下拉里明确选的那个加速地址**，不是 S_accelBase）：
  //     不传它的时候只能拿 S_accelBase 兜底，而那个语义是「raw 拉不到时兜底用哪个站」，
  //     与「用户现在想用哪个站」是两件事。踩过的坑：用户从 gh-proxy.org 切到
  //     ghproxy.net、再点「取消」要退回原来的站 —— 取消时 S_accelBase 已经被改成了
  //     ghproxy.net，若这里还读 S_accelBase，就会把 gh-proxy 那次的源又拼回 ghproxy.net。
  //     **回退必须把目标地址显式传进来。**
  function repinModelsBase(force, whyBase) {
    if (!S_baseCandidates.length) return false;
    var br = S_branchByBase[S_modelsBase] || BRANCHES[0];
    var raw = rawBaseOf(br);
    // ⚠️⚠️ 「当前是不是已经在加速源上」必须**靠身份**（S_baseName）判断，
    //    不能写成 `S_modelsBase === accelerate(raw, S_accelBase)` ——
    //    那样算出来的结果会被**同一次操作里刚更新的 S_accelBase** 带动：
    //    用户从 A 站换到 B 站时，S_accelBase 已经是 B 了，而当前源还是 A 开头的，
    //    两者一比不相等 → 判定成「不是加速态」→ 重拼到 B —— 正是要避免的那件事。
    //    S_baseName 是 baseName() 按主机名给的，与「用的是哪个站」无关，稳。
    var isRaw = S_baseName === 'github' || S_modelsBase === raw;
    var next = S_modelsBase;

    if (force === 'accel') {
      var a = normalizeAccelBase(whyBase) || S_accelBase ||
              normalizeAccelBase(ACCEL_PRESETS[0] && ACCEL_PRESETS[0].base);
      if (!a) return false;                 // 一个加速地址都拿不到 —— 保持原样比乱切好
      next = accelerate(raw, a);
    } else if (force === 'github') {
      if (isRaw) return false;
      next = raw;
    } else {
      return false;
    }

    if (next === S_modelsBase) return false;
    var prev = S_modelsBase;
    S_branchByBase[next] = S_branchByBase[next] || br;
    S_modelsBase = next;
    S_baseName = baseName(next);
    // 候选表按新源重建（保留同一分支的另一源作为兜底）
    pinBranch(next);
    // ⚠️ 再兜一道：pinBranch 的 accelFirst 是按传进去的 base 判的，语义上应该已经对；
    //    但「cands[0] === S_modelsBase」是两条取源路径（拼 URL / 试清单）的共同前提，
    //    这里显式钉一次，免得将来 pinBranch 改动把它再度拽偏（见 promoteModelsBase 注释）。
    promoteModelsBase(next);
    console.warn('[viewer] 数据源已切换：' + prev + ' → ' + next);
    return true;
  }

  // 从 GitHub Pages / 自定义域名里推断出 用户名/仓库名
  function inferRepo() {
    var h = location.hostname;
    var m = /^([^.]+)\.github\.io$/i.exec(h);
    if (m) {
      var seg = location.pathname.split('/').filter(Boolean);
      return { owner: m[1], repo: seg[0] || (m[1] + '.github.io') };
    }
    return null;
  }

  // 顶栏的 GitHub 图标指向哪里：部署在 *.github.io 上时按当前地址推断出仓库，
  // 推不出来（本地预览 / 自定义域名）就用 REPO_URL。
  function setupRepoLink() {
    if (!els.ghLink) return;
    var info = inferRepo();
    var url = info ? ('https://github.com/' + info.owner + '/' + info.repo) : REPO_URL;
    els.ghLink.href = url;
    els.ghLink.title = '打开 GitHub 仓库 · ' + url;
  }

  // A. 读取 models_tool.py 生成的索引（仓库根目录的 models.json）
  // ⚠️ 它是「清单」—— 与页面同源发布只是历史巧合：模型分离后它跟模型一起留在
  //    master，页面从外部基址取。**它是「新增模型能否被看到」的关键**：
  //    模型文件传上去、清单没更新的话，页面列表里根本不会出现它。
  function discoverFromIndex() {
    return fetchRepoJSON('models.json').then(function (d) {
      var list = (d && d.models) || [];
      if (!list.length) throw new Error('models.json 为空');
      return list;
    });
  }

  // 统一整理：补出 group / parts / key 等字段，供 UI 分组使用
  function decorate(list) {
    return list.map(function (m) {
      var p = m.path || '';
      var parts = p ? p.split('/').filter(Boolean) : [];
      var group = m.group !== undefined ? m.group : (parts.length > 1 ? parts.slice(0, -1).join('/') : '');
      var model = m.file || m.model || '';
      return {
        path: p,
        file: model,
        model: model,
        name: m.name || model.replace(/\.model3\.json$/i, ''),
        group: group,
        parts: m.parts || parts,
        motions: m.motions || 0,
        textures: m.textures || 0,
        mocVersion: m.mocVersion || '',
        key: p + '/' + model,          // 唯一标识，用于记忆上次选择
        missing: m.missing || []
      };
    });
  }

  function discoverModels() {
    S.source = '';
    return discoverFromIndex()
      .then(function (list) { S.source = 'index'; return list; })
      .catch(function (e1) {
        var fb = window.MODELS_FALLBACK || [];
        if (!fb.length) {
          var err = new Error('未发现任何模型');
          err.reasons = [e1 && e1.message].filter(Boolean);
          throw err;
        }
        S.source = 'fallback';
        return fb;
      })
      .then(function (list) { return decorate(list); });
  }

  // ---------- 2. 侧栏渲染 ----------
  // 侧栏的分组 = 模型在仓库里的**文件夹路径**，逐级嵌套：
  //   · 本仓库的模型   → models/ 下的目录（models.json 的 group，多级用 / 拼）
  //   · 外部源的模型   → 最外层多套一层 owner（表示「来自哪个仓库」），里面仍是它自己的目录
  //   · 本地导入的模型 → 固定挂在「本地模型」下
  //
  // ⚠️ 分组层级的唯一来源是 m.group（decorate 里由 path 推出，models.json 也可能直接给）。
  //    2026-09-22 之前外部源把 group 强制改成 owner，等于把整个仓库压成一层 ——
  //    'Azue Lane(JP)/aierdeliqi_4' 在侧栏里完全看不出文件夹结构。现在 owner 只是最外那层。
  function folderPathOf(m) {
    var segs = String(m.group || '').split('/').filter(Boolean);
    return m._external ? [m._external.owner].concat(segs) : segs;
  }

  // 按文件夹路径把模型组织成树。节点 = { name, key, extOwner, children, items }
  //   key 是「从根到本节点」的完整路径，同时用作折叠状态的键 —— 不同外部源下的同名文件夹
  //   因此互不影响（'fakeowner/Azue Lane(JP)' vs 本仓库的 'Azue Lane(JP)'）。
  function buildFolderTree(list) {
    var root = { name: '', key: '', extOwner: null, children: [], items: [] };
    list.forEach(function (m) {
      var node = root, path = folderPathOf(m);
      path.forEach(function (seg, i) {
        var child = null;
        for (var j = 0; j < node.children.length; j++) {
          if (node.children[j].name === seg) { child = node.children[j]; break; }
        }
        if (!child) {
          child = { name: seg, key: (node.key ? node.key + '/' : '') + seg,
                    // 第一段且来自外部源 → 这层就是「哪个仓库」，记下 owner 给 ✕ 用
                    extOwner: (i === 0 && m._external) ? m._external : null,
                    children: [], items: [] };
          node.children.push(child);
        } else if (i === 0 && m._external && !child.extOwner) {
          // owner 名恰好和本仓库某个文件夹同名时，这层会被两边共用（本仓库的模型先建了节点）。
          // 补上 owner —— 否则 ✕（移除整组）会静默消失，外部源就再也删不掉了。
          child.extOwner = m._external;
        }
        node = child;
      });
      node.items.push(m);
    });
    sortTree(root);
    return root;
  }

  // 每层顺序：子文件夹在前（组名升序，本地导入固定最后），本层散放的模型在后。
  // 与改造前一致 —— 原来「有分组的排前面、顶层散放最后」的规则原样保留。
  function sortTree(node) {
    node.children.sort(function (a, b) { return cmpGroupKey(a.name, b.name); });
    node.children.forEach(sortTree);
  }

  function cmpGroupKey(a, b) {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a === LOCAL_GROUP) return 1;
    if (b === LOCAL_GROUP) return -1;
    return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
  }

  // 深度优先展开（子文件夹 → 本层散放）。这个顺序**就是**侧栏里看到的顺序。
  //
  // ⚠️ 「列表循环」的「列表」正是用户眼前这个列表，必须与渲染顺序严格一致，
  //    否则轮播时侧栏高亮会忽前忽后地跳。所以顺序只在这里定义一次，渲染和轮播共用。
  function flattenTree(node, out) {
    out = out || [];
    node.children.forEach(function (ch) { flattenTree(ch, out); });
    node.items.forEach(function (m) { out.push(m); });
    return out;
  }

  // 节点下的模型总数（含所有子层）—— 分组头右侧那个数字
  function countOf(node) {
    var n = node.items.length;
    node.children.forEach(function (ch) { n += countOf(ch); });
    return n;
  }

  // 侧栏当前「看得见」的模型，顺序与侧栏里显示的一致
  function visibleModels() {
    var kw = (els.modelSearch.value || '').trim().toLowerCase();
    var matched = S.models.filter(function (m) {
      if (!kw) return true;
      var hay = (modelTitle(m) + ' ' + m.name + ' ' + m.path).toLowerCase();
      return hay.indexOf(kw) !== -1;
    });
    if (kw) return matched;   // 搜索时是平铺展示，顺序就是 S.models 的顺序
    return flattenTree(buildFolderTree(matched));
  }

  function renderModels() {
    var kw = (els.modelSearch.value || '').trim().toLowerCase();
    els.modelList.innerHTML = '';

    // 顺序已经由 visibleModels() 定好（组名升序、顶层最后），这里只管画
    var matched = visibleModels();

    // 来源标注：清单从哪来 + 模型从哪个源取（GitHub 原始 / 加速地址 / 本机）。
    // 分离部署后「模型来自外部 CDN」是件用户该看得见的事 —— 出问题时一眼知道该查谁。
    var srcLabel = { index: 'models.json', fallback: '内置清单' }[S.source] || '';
    var baseTag = { github: 'GitHub', accel: '加速', local: '' }[S_baseName] || '';
    var tag = [srcLabel, baseTag].filter(Boolean).join(' · ');
    els.modelCount.textContent = kw
      ? matched.length + ' / ' + S.models.length + ' 个'
      : '共 ' + S.models.length + ' 个' + (tag ? ' · ' + tag : '');

    if (!matched.length) {
      var empty = document.createElement('div');
      empty.className = 'model-item';
      empty.style.cursor = 'default';
      empty.innerHTML = '<div class="desc" style="font-size:11.5px;">没有匹配的模型</div>';
      els.modelList.appendChild(empty);
      return;
    }

    if (kw) {
      // 搜索时平铺展示，并标注它属于哪个分组
      matched.forEach(function (m) { els.modelList.appendChild(buildModelItem(m, true)); });
      return;
    }

    // 默认按文件夹树折叠展示：顺序已经由 visibleModels() 定好，这里只按树递归画
    appendTree(els.modelList, buildFolderTree(matched), 0);
  }

  // 递归画一棵子树：先子文件夹、再本层散放的模型（与 flattenTree 的顺序严格一致）
  function appendTree(container, node, depth) {
    node.children.forEach(function (ch) { container.appendChild(buildGroup(ch, depth)); });
    node.items.forEach(function (m) { container.appendChild(buildModelItem(m, false)); });
  }

  function buildModelItem(m, showCrumb) {
    var el = document.createElement('div');
    var active = S.model && m.key === S.model.key;
    el.className = 'model-item' + (active ? ' on' : '');
    // 搜索结果里标出它属于哪个分组（外部源连 owner 一起标 —— 不然和本仓库的同名文件夹
    // 分不出谁是谁，这正是这次要解决的问题）
    var sub = showCrumb ? folderPathOf(m).join('/') : '';
    var meta = '';
    if (m._local) meta = '本地导入' + (m.motions ? ' · ' + m.motions + ' 个动作' : ' · 无动作');
    else if (m.motions) meta = m.motions + ' 个动作';
    el.innerHTML =
      '<div class="dot"></div>' +
      '<div class="meta" style="min-width:0;flex:1 1 auto;">' +
        '<div class="name">' + escapeHtml(modelTitle(m)) + '</div>' +
        '<div class="' + (sub ? 'crumb' : 'desc') + '">' +
          escapeHtml(sub || meta || m.name) +
        '</div>' +
      '</div>';
    el.title = m.path + '/' + m.file;
    el.addEventListener('click', function () { switchModel(m); });

    // 外部源模型：右侧加一个「GitHub / 加速」小标签，让用户一眼看出这是别的仓库的
    if (m._external) {
      var tag = document.createElement('div');
      tag.className = 'ext-tag';
      tag.textContent = m._external.source === 'accel' ? '加速' : 'GitHub';
      tag.title = m._external.owner + ' / ' + m._external.repo + '@' + m._external.branch +
                  '\n来源：' + (m._external.source === 'accel'
                    ? (accelLabel(m._external.accel) + '（加速）')
                    : 'raw.githubusercontent.com');
      el.appendChild(tag);
    }

    // 本地导入的模型只在这次会话里存在（文件在内存里，刷新就没了），
    // 给它一个移除入口，免得列表越攒越长、blob URL 一直不释放。
    if (m._local) {
      var rm = document.createElement('button');
      rm.className = 'mi-rm';
      rm.type = 'button';
      rm.title = '从列表移除（文件本来就在你本地，不会被删除）';
      rm.setAttribute('aria-label', '移除本地模型 ' + m.name);
      rm.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" ' +
                     'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
                     '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>';
      rm.addEventListener('click', function (ev) {
        ev.stopPropagation();       // 别顺手把模型也切过去
        ev.preventDefault();
        removeLocalModel(m.key);
      });
      el.appendChild(rm);
    }
    return el;
  }

  // 画一个分组节点（递归）。node 来自 buildFolderTree()：
  //   node.name    显示名（文件夹名；外部源那层是 owner）
  //   node.key     折叠状态的键 = 从根到这里的完整路径
  //   node.extOwner  非空 = 这层是外部源的「源」层，头右侧给个 ✕ 删整组
  function buildGroup(node, depth) {
    var wrap = document.createElement('div');
    // 默认折叠：只有用户显式展开过的（=== false）才摊开，
    // 没记录的分组一律收起来 —— 40 个模型一次全铺开会占掉整条侧栏。
    var collapsed = S.collapsed[node.key] !== false;
    wrap.className = 'group' + (collapsed ? ' collapsed' : '');
    wrap.dataset.group = node.key;
    // 层级：0 = 顶层（本仓库的文件夹 / 外部源的 owner），>0 = 更深的子文件夹。
    // 样式靠 .group-body 的 padding-left 逐层缩进，这个属性只给自动化断言用。
    wrap.dataset.depth = String(depth);

    var head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML =
      '<span class="caret">' +
        '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2.5 4.2 6 7.8l3.5-3.6"/></svg>' +
      '</span>' +
      '<span class="gname">' + escapeHtml(node.name) + '</span>' +
      '<span class="gcount">' + countOf(node) + '</span>';
    head.title = node.key + '（点击折叠 / 展开）';
    head.addEventListener('click', function () {
      var nowCollapsed = !wrap.classList.contains('collapsed');
      wrap.classList.toggle('collapsed', nowCollapsed);
      S.collapsed[node.key] = nowCollapsed;
      saveState();
    });

    // 外部源的「源」层：加一个「✕」删整组 —— 与列表项里的 mi-rm 同思路，
    // stopPropagation 防止顺手把分组折叠了。⚠️ 只长在这一层（子文件夹层不带）。
    if (node.extOwner) {
      var rm = document.createElement('button');
      rm.className = 'ext-rm';
      rm.type = 'button';
      rm.title = '移除外部源：' + node.extOwner.owner + ' / ' + node.extOwner.repo + '@' + node.extOwner.branch +
                 '\n（删掉该 owner 在侧栏里的全部模型，本次会话）';
      rm.setAttribute('aria-label', '移除外部源 ' + node.extOwner.owner);
      rm.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" ' +
                     'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
                     '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>';
      rm.addEventListener('click', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        removeExternalSource(node.extOwner.owner);
      });
      head.appendChild(rm);
    }

    var body = document.createElement('div');
    body.className = 'group-body';
    appendTree(body, node, depth + 1);

    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 页面里不再有动作列表，当前动作的序号与名称直接写在舞台左上角的信息条上。
  function renderMotionBadge() {
    var mo = S.motions[S.current];
    if (!mo) { els.badgeMotion.textContent = '—'; return; }
    els.badgeMotion.textContent =
      (S.current + 1) + '/' + S.motions.length + ' · ' + prettyName(mo.base) +
      (mo.duration ? ' · ' + mo.duration.toFixed(1) + 's' : '');
  }

  // ---------- 3. 载入模型 ----------
  // 解析动作清单。
  //
  // mf  —— model3.json 的内容
  // relOf —— 可选，把「动作对象的 File 值」还原成「原始相对路径」。
  //          本地导入的模型在写进 model3.json 之前，所有 File 都被换成了 blob: URL
  //          （blob URL 之间没法互相解析相对路径），而显示名和「是不是 idle」的判定
  //          都得看原始文件名，所以这里要能反查回去。
  //          远程模型不需要（relOf 缺省就是恒等函数）。
  function parseMotions(mf, relOf) {
    relOf = relOf || function (x) { return x; };
    var raw = (mf.FileReferences && mf.FileReferences.Motions) || {};
    var out = [];
    Object.keys(raw).forEach(function (group) {
      (raw[group] || []).forEach(function (item, idx) {
        var file = item.File;
        if (!file) return;
        // file 用于 fetch、以及与 SDK 的 definitions[group][i].File 比对，必须是「真正要取的那个值」
        // rel 只用于显示名和 idle 判定，始终是模型作者写的那个相对路径
        var rel = String(relOf(file) || file).replace(/\\/g, '/');
        var sound = item.Sound || null;
        out.push({
          file: file,
          rel: rel,
          base: rel.split('/').pop(),
          group: group,
          localIndex: idx,
          loop: group === 'Idle' || /(^|\/)idle\./i.test(rel) || /\bidle\b/i.test(rel),
          duration: 0,
          sound: sound
        });
      });
    });
    return out;
  }

  // 相对路径 → 可直接 fetch 的绝对地址。
  // 远程模型是 models/<path>/<file>；本地导入的模型 File 已经是 blob: URL，原样返回。
  function absUrl(base, f) {
    if (/^(blob:|data:|https?:)/i.test(f)) return f;
    return base + f;
  }

  // 停掉正在播放的语音
  function stopCurrentAudio() {
    if (S._curAudio) {
      try { S._curAudio.pause(); } catch (e) {}
      S._curAudio.currentTime = 0;
      S._curAudio = null;
    }
  }

  // 播放动作对应的语音（如果有）
  function playMotionSound(mo) {
    stopCurrentAudio();
    if (!S.soundEnabled || !mo || !mo.sound) return;
    try {
      var a = new Audio(absUrl(S._baseUrl, mo.sound));
      S._curAudio = a;
      a.play().catch(function () { S._curAudio = null; });
    } catch (e) {}
  }

  // 按分组名 + 组内下标查找 S.motions 里的动作（用于 SDK hitTest 回调）
  function findMotionByGroupIndex(group, localIndex) {
    for (var i = 0; i < S.motions.length; i++) {
      var m = S.motions[i];
      if (m.group === group && m.localIndex === localIndex) return m;
    }
    return null;
  }

  function probeDurations(baseUrl) {
    return Promise.all(S.motions.map(function (mo) {
      return fetch(absUrl(baseUrl, mo.file), { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var d = j && j.Meta && j.Meta.Duration;
          if (typeof d === 'number') { mo.duration = d; if (j.Meta.Loop === true) mo.loop = true; }
        })
        .catch(function () { /* 拿不到时长不影响预览 */ });
    }));
  }

  function switchModel(m) {
    // 载入中又点了别的模型：别直接丢掉这次点击（用户会觉得「点了没反应」），
    // 记成 pending，等当前这次载完再切过去。同一时刻只保留最后一次点击。
    if (S.busyModel) {
      // 已经就是正在载入的那个 → 不必再排队
      if (!S.model || (S.model.key !== m.key)) S.pendingModel = m;
      return;
    }
    S.pendingModel = null;
    S.busyModel = true;

    // 换模型必须把播放状态整体复位。
    // 上一轮加的「播完自动停」会把 S.playing 置成 false；若不在这里复位，
    // 新模型载入后虽然调了 playMotion()，但因为 S.playing 是 false、时间轴不走，
    // 画面上看就是「切了模型之后不会自动播放」。
    resetPlayState();
    showOverlay('正在载入模型 ' + modelTitle(m) + ' …', '读取模型配置与动作数据', false, true);

    // 模型的完整目录：models/<path>
    // 本地导入的模型（m._local）所有文件都是内存里的 blob URL，
    // model3.json 本身也是一个 blob URL，没有「目录」这个概念。
    // 外部模型（m._external）走自己的 base（owner 的仓库在另一个分支上），
    // 不能再吃全局 S_modelsBase —— 不然 owner 仓库的模型会跑到这个 fetch 里去找。
    // ⚠️ 非本地 / 非外部模型走 modelsUrl() —— 它会在「页面与模型分离」的部署形态下
    //    补上 raw / 加速地址的绝对前缀（模型在 master，页面在 gh-pages）。
    var local = m._local || null;
    var external = m._external || null;
    var baseUrl = local ? ''
      : external ? (external.base + 'models/' + (m.path ? m.path + '/' : ''))
      : modelsUrl('models/' + (m.path ? m.path + '/' : ''));
    S._baseUrl = baseUrl;
    var manifestUrl = local ? local.jsonUrl : (baseUrl + m.file);
    var t0 = Date.now();

    fetchJSON(manifestUrl).then(function (mf) {
      S.model = m;
      S.motions = parseMotions(mf, local ? function (u) { return local.relByUrl[u]; } : null);
      S.current = -1;
      els.badgeName.textContent = modelTitle(m);
      els.badgeMotion.textContent = '—';
      els.badge.style.display = '';
      renderModels();
      return probeDurations(baseUrl);
    }).then(function () {
      renderMotionBadge();
      showOverlay('正在载入模型 ' + modelTitle(m) + ' …', '解析纹理与网格', false, true);
      return loadIntoStage(manifestUrl);
    }).then(function () {
      // 首次载入默认不播放；之后切换模型自动播放。
      if (S.motions.length) {
        playMotion(0, true);
        if (S._firstLoad) {
          S.playing = false;
          var mm = motionManager();
          if (mm) { try { mm.playing = false; } catch (e) {} }
          setPlayIcon();
        }
      }
      S.app.render();
      // 至少展示 350ms，避免加载过快时遮罩闪烁
      var wait = Math.max(0, 350 - (Date.now() - t0));
      return new Promise(function (res) { setTimeout(res, wait); });
    }).then(function () {
      hideOverlay();
      S.busyModel = false;
      S._firstLoad = false;
      saveState();
      // 若当前模型在折叠的分组里，自动展开该分组
      revealActiveModel();
      drainPendingModel();
    }).catch(function (e) {
      S.busyModel = false;
      // 当前源「半死」：清单取到了、模型资源取不到（限速 / CDN 抽风的典型症状）。
      // 读清单那一步的探源发现不了这种情况，所以这里再给一次机会 ——
      // 切到备用源，把整次载入重来。每个模型只重试一次，不会来回打转。
      // ⚠️ 必须在 `S.busyModel = false` **之后**再调 switchModel：
      //    它开头有 busyModel 守卫，还在忙的话这次重试会被丢进 pending。
      // ⚠️ 外部模型的「备用源」切的是它自己的（github ↔ accel），不动全局 S_modelsBase ——
      //    一个外部仓库挂了不能把整个页面的源切走，否则本仓库的模型跟着受害。
      if (!m._local && !m._srcRetried) {
        if (m._external) {
          var alt = altBase(m._external);
          if (alt) {
            m._srcRetried = true;
            // 把 _external 改成备用源，但 key / owner 不变（同一组外部模型）
            m._external.base = alt.base;
            m._external.source = alt.source;
            m._external.accel = alt.accel || '';
            m._external.url = alt.url;
            switchModel(m);
            return;
          }
        } else if (advanceModelsBase()) {
          m._srcRetried = true;
          switchModel(m);
          return;
        }
      }
      // 载入失败时把舞台清干净，否则会留着上一个模型或半成品状态，
      // 用户再点别的模型时会因为 busyModel / 残留队列而表现异常。
      try {
        if (S.l2dModel) { S.app.stage.removeChild(S.l2dModel); S.l2dModel.destroy(); }
      } catch (e2) {}
      S.l2dModel = null;
      flushRevokes();
      S.motions = [];
      S.current = -1;
      els.badge.style.display = 'none';
      showOverlay('模型载入失败：' + modelTitle(m), String((e && e.message) || e), true, false);
      drainPendingModel();
    });
  }

  // 载入过程中用户又点了别的模型 → 现在补切过去
  function drainPendingModel() {
    var next = S.pendingModel;
    if (!next) return;
    S.pendingModel = null;
    switchModel(next);
  }

  // 复位所有播放状态。换模型时必须调用，否则上一模型的定格/暂停/播完标记
  // 会带到新模型上，表现为「切过来不会自动播放」。
  function resetPlayState() {
    stopCurrentAudio();
    S.playing = true;
    S.finished = false;
    S.motionClock = 0;
    S.holdTime = 0;
    S._advancing = false;
    clearHoldEntry();
    setPlayIcon();
  }

  // 当前模型在侧栏里的折叠键路径，从外到内 —— 外部源是
  // ['fakeowner', 'fakeowner/Azue Lane(JP)'] 两级，本仓库模型只有一级。
  // 顶层散放的模型返回空数组（它本来就没有分组可展开）。
  function folderKeysOf(m) {
    var keys = [], k = '';
    folderPathOf(m).forEach(function (seg) { k = k ? k + '/' + seg : seg; keys.push(k); });
    return keys;
  }

  function revealActiveModel() {
    if (!S.model) return;
    var keys = folderKeysOf(S.model);
    if (!keys.length) return;
    // ⚠️ 第一次调用必须「只记账不动作」：boot() 里第一个模型载入完就会走到这里，
    //    照常展开的话用户第一眼看到的还是摊开的分组，「默认不展开」就白设了。
    //    之后的切换（列表循环自动切、本地导入上架）才真的展开，否则用户
    //    根本不知道画面换成了谁。
    if (!S._revealedOnce) { S._revealedOnce = true; return; }
    // 逐层展开 —— 外部源要展开「源」和里面的文件夹两层，只展开一层等于没展开
    var changed = false;
    keys.forEach(function (k) {
      if (S.collapsed[k] !== false) { S.collapsed[k] = false; changed = true; }
    });
    if (!changed) return;
    saveState();
    renderModels();
  }

  function loadIntoStage(manifestUrl) {
    return new Promise(function (resolve, reject) {
      // 卸载旧模型
      if (S.l2dModel) {
        try { S.app.stage.removeChild(S.l2dModel); S.l2dModel.destroy(); } catch (e) {}
        S.l2dModel = null;
      }
      // 旧模型已经 destroy，之前排队的 blob URL 现在可以安全释放了
      flushRevokes();
      return PIXI.live2d.Live2DModel.from(manifestUrl, {
        autoInteract: false,
        autoUpdate: true,
        // ⚠️ 这个值必须「非空且不存在于任何模型的动作分组里」，见下面 disableAutoIdle 的说明。
        //    之前写的是空串 '' —— 空串是 falsy，SDK 的 `(t?.idleMotionGroup) && ...` 直接跳过，
        //    等于没设，SDK 的自动 Idle 一直在偷偷运行。
        idleMotionGroup: NO_IDLE_GROUP,
        motionPreload: 'ALL'
      }).then(function (model) {
        S.l2dModel = model;
        S.primed = false;    // 新模型的新队列还没初始化，先让 tickProgress 站住
        S.app.stage.addChild(model);
        model.interactive = false;
        model.anchor.set(0.5, 0.5);

        // 时间轴完全由 tickProgress 接管（SDK 自带的 update 不累加时间，留着反而会
        // 用错误的帧间隔覆盖参数）
        model.autoUpdate = false;

        // 关闭 SDK 的自动 Idle 动作，动作序列完全由页面控制
        disableAutoIdle(model.internalModel && model.internalModel.motionManager);

        // 眼部跟随鼠标
        model.on('pointermove', function () {});

        // 点击模型身体触发 TapBody 等有声动作（SDK hitTest + 我们的动作系统）
        model.on('hit', function (hitAreas) {
          if (!hitAreas || !hitAreas.length || !S.motions.length) return;
          var mm = model.internalModel && model.internalModel.motionManager;
          if (!mm || !mm.definitions) return;
          var groups = Object.keys(mm.definitions);
          // 1. 尝试精确匹配：hitArea 名 ↔ 动作分组名
          for (var g = 0; g < groups.length; g++) {
            var grp = groups[g];
            for (var h = 0; h < hitAreas.length; h++) {
              var ha = hitAreas[h].toLowerCase();
              if (grp.toLowerCase().indexOf(ha) !== -1 || ha.indexOf(grp.toLowerCase()) !== -1) {
                var defs = mm.definitions[grp];
                if (defs && defs.length) {
                  var idx = Math.floor(Math.random() * defs.length);
                  var mo = findMotionByGroupIndex(grp, idx);
                  if (mo) { playMotion(S.motions.indexOf(mo)); return; }
                }
              }
            }
          }
          // 2. 兜底：从第一个有声音的分组里随机播一个
          for (var g2 = 0; g2 < groups.length; g2++) {
            var grp2 = groups[g2];
            var defs2 = mm.definitions[grp2];
            if (defs2 && defs2.length && defs2[0].Sound) {
              var idx2 = Math.floor(Math.random() * defs2.length);
              var mo2 = findMotionByGroupIndex(grp2, idx2);
              if (mo2) { playMotion(S.motions.indexOf(mo2)); return; }
            }
          }
        });
        layoutModel(true);
        // 新模型的第一帧就要是干净的（去掉多余图层），不能等 tickProgress 下一帧
        applyHiddenLayers();
        // 部件面板：换模型后清掉旧模型的勾选与基准，挂上新模型的 coreModel 钩子。
        // 面板的覆盖是「临时」的 —— 切模型就丢掉。
        resetPartsPanel();
        installPartsCoreHook();
        capturePartsBaseline();
        buildParts();
        if (els.partsSearch) els.partsSearch.value = '';
        renderParts();
        resolve(model);
      }).catch(reject);
    });
  }

  // ---------- 部件 / 网格的隐藏（右侧「部件面板」的临时覆盖） ----------
  //
  // ⚠️ 为什么需要这个东西：有些模型在导出时丢掉了部分 drawable 的「不透明度参数绑定」。
  //    这些网格的静态不透明度是 1，而 moc3 里没有任何参数能改变它 —— 于是本该只在
  //    特定动作里出现的备用手/手臂永久显示，看上去就是「多了一只手」。
  //
  //    以 zhala_2 为例（已用 181 个参数逐个推到 min/max 验证过，透明度/可见性/顶点
  //    三项全都不动，说明绑定确实不存在于 moc3 里）：
  //      PartHandLCongxia    —— 10 张网格（armfore_l3 + hand_l_default_shouzhang_upper 等）
  //      PartHandLNakaiDuli  —— 7 张网格（hand_l_nakai_*2 共 5 张 + hand_l_nie_shouzhang3 + armfore_l_peng3）
  //    这 17 张正好是 moc3 里 drawable 顺序的最后 17 个（后期追加进去、绑定没带过来）。
  //    它们本该由 ParamHandLCongxiaAlpha / ParamHandLNakaiAlpha / ParamHandLNakai2Alpha 控制，
  //    这三个参数确实存在、也确实被 login.motion3.json 驱动（NakaiAlpha 在 login 前 10.2 秒为 1），
  //    但网格这一侧没有读它们。**任何渲染器都会把它们画出来，不是本页面的问题。**
  //
  //    既然网格侧无法自己恢复绑定，就只能手动隐藏：右侧「部件面板」里把对应部件/网格
  //    的不透明度拉到 0 即可，切模型后失效（面板的覆盖是临时的）。
  //
  //    注意：这里必须每帧重设。SDK 每次 update 都会按绑定重新计算不透明度，
  //    被重置的正是我们手工写进去的 0。
  //
  //    覆盖分两层：部件层（parts.opacities）在这里写，位置是 im.update 之前；
  //    网格层（_drawHide）走 installPartsCoreHook —— 必须在 csmUpdateModel 之后
  //    才能清 drawables.dynamicFlags 的 bit0，这里够不着。
  function applyHiddenLayers() {
    var im = S.l2dModel && S.l2dModel.internalModel;
    if (!im || !im.coreModel) return;
    var core = im.coreModel;
    var m = core._model || core;          // CubismModel 包装层下面才是真正的 core model
    if (!m || !m.parts) return;
    var parts = m.parts;

    if (S._partOp) {
      var po = parts.opacities;
      for (var k in S._partOp) {
        if (!Object.prototype.hasOwnProperty.call(S._partOp, k)) continue;
        var i = +k;
        if (i >= 0 && i < po.length) po[i] = S._partOp[k];
      }
    }
  }

  // ---------- 把当前模型打包成 zip 下载 ----------
  //
  // 模型目录里的文件是靠 model3.json 的 FileReferences 串起来的，所以顺着引用关系
  // 收集就能得到一份「解压即用」的模型目录 —— 不需要服务端列目录
  // （Pages 是静态托管，浏览器也没法列目录）。
  //
  // zip 用 **STORE（不压缩）**：moc3 / png / mp3 本来就已经压过了，再 deflate 收益极小，
  // 却要额外引一个压缩库。store 格式只要自己算 CRC32 就行，几十行搞定。
  // zip 里套一层以模型目录名命名的文件夹，解压后直接丢进 models/ 就能被页面认出来。

  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // zip 里的时间戳用 DOS 格式（年从 1980 起算），填 0 的话解压出来会显示成 1979 年
  function dosDateTime(d) {
    var y = d.getFullYear();
    if (y < 1980) y = 1980;
    return {
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    };
  }

  function buildZip(entries, when) {
    var dt = dosDateTime(when || new Date());
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;

    for (var i = 0; i < entries.length; i++) {
      var nameBytes = enc.encode(entries[i].name);
      var data = entries[i].data;
      var crc = crc32(data);

      var head = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(head.buffer);
      dv.setUint32(0, 0x04034b50, true);          // 本地文件头签名
      dv.setUint16(4, 20, true);                  // 需要的版本 2.0
      dv.setUint16(6, 0x0800, true);              // bit11：文件名是 UTF-8
      dv.setUint16(8, 0, true);                   // 压缩方式 0 = 不压缩
      dv.setUint16(10, dt.time, true);
      dv.setUint16(12, dt.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);        // 压缩后大小
      dv.setUint32(22, data.length, true);        // 原始大小
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);                  // 扩展字段长度
      head.set(nameBytes, 30);

      parts.push(head, data);
      central.push({ name: nameBytes, crc: crc, size: data.length, offset: offset });
      offset += head.length + data.length;
    }

    var cd = [], cdSize = 0;
    for (var j = 0; j < central.length; j++) {
      var c = central[j];
      var rec = new Uint8Array(46 + c.name.length);
      var d2 = new DataView(rec.buffer);
      d2.setUint32(0, 0x02014b50, true);          // 中央目录项签名
      d2.setUint16(4, 20, true);                  // 创建版本
      d2.setUint16(6, 20, true);                  // 需要的版本
      d2.setUint16(8, 0x0800, true);
      d2.setUint16(10, 0, true);
      d2.setUint16(12, dt.time, true);
      d2.setUint16(14, dt.date, true);
      d2.setUint32(16, c.crc, true);
      d2.setUint32(20, c.size, true);
      d2.setUint32(24, c.size, true);
      d2.setUint16(28, c.name.length, true);
      d2.setUint16(30, 0, true);                  // 扩展字段
      d2.setUint16(32, 0, true);                  // 注释
      d2.setUint16(34, 0, true);                  // 起始磁盘号
      d2.setUint16(36, 0, true);                  // 内部属性
      d2.setUint32(38, 0, true);                  // 外部属性
      d2.setUint32(42, c.offset, true);           // 本地文件头偏移
      rec.set(c.name, 46);
      cd.push(rec);
      cdSize += rec.length;
    }

    var end = new Uint8Array(22);
    var d3 = new DataView(end.buffer);
    d3.setUint32(0, 0x06054b50, true);            // 中央目录结束记录
    d3.setUint16(4, 0, true);
    d3.setUint16(6, 0, true);
    d3.setUint16(8, central.length, true);
    d3.setUint16(10, central.length, true);
    d3.setUint32(12, cdSize, true);
    d3.setUint32(16, offset, true);
    d3.setUint16(20, 0, true);                    // 注释长度

    return new Blob(parts.concat(cd, [end]), { type: 'application/zip' });
  }

  // 顺着 FileReferences 把所有被引用的文件列出来（相对模型目录）
  function collectModelRefs(mf) {
    var fr = (mf && mf.FileReferences) || {};
    var out = [];
    function add(p) {
      if (!p || typeof p !== 'string') return;
      var s = p.replace(/\\/g, '/').replace(/^\.\//, '');
      if (out.indexOf(s) < 0) out.push(s);
    }
    add(fr.Moc);
    add(fr.Physics);
    add(fr.Pose);
    add(fr.UserData);
    add(fr.DisplayInfo);
    (fr.Textures || []).forEach(add);
    (fr.Expressions || []).forEach(function (e) { if (e) add(e.File); });
    var mg = fr.Motions || {};
    Object.keys(mg).forEach(function (g) {
      (mg[g] || []).forEach(function (mo) {
        if (!mo) return;
        add(mo.File);
        add(mo.Sound);     // 语音也一起带上，否则动作里的台词就没了
      });
    });
    return out;
  }

  // 打包当前模型，resolve 出 { blob, root, count, failed }
  function packCurrentModel() {
    var m = S.model;
    if (!m) return Promise.reject(new Error('还没有选中模型'));
    var baseUrl = modelsUrl('models/' + (m.path ? m.path + '/' : ''));
    var root = (m.path ? m.path.split('/').pop() : '') || m.name || 'model';

    return fetchJSON(baseUrl + m.file).then(function (mf) {
      var rels = [m.file].concat(collectModelRefs(mf));
      var entries = [], failed = [], done = 0;

      // 顺序抓取：模型动辄几十个文件，一次性并发会把浏览器的连接池占满，
      // 反而拖慢整体，也不好显示进度。
      return rels.reduce(function (chain, rel) {
        return chain.then(function () {
          return fetch(baseUrl + rel).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.arrayBuffer();
          }).then(function (buf) {
            entries.push({ name: root + '/' + rel, data: new Uint8Array(buf) });
          }).catch(function () {
            failed.push(rel);   // 引用了但文件不存在 → 跳过，不阻断整体
          }).then(function () {
            done++;
            // 只有「用户点了下载」时才改按钮文案。
            // 不加这个判断的话，任何直接调 pack() 的地方（例如自动化验收）都会把
            // 按钮永久留在「打包中 N/M」上 —— 恢复文案的逻辑在 downloadCurrentModel 里。
            if (S.downloading && els.btnDownload) {
              els.btnDownload.title = '打包中 ' + done + '/' + rels.length;
            }
          });
        });
      }, Promise.resolve()).then(function () {
        if (!entries.length) throw new Error('一个文件都没取到，检查网络或路径');
        return { blob: buildZip(entries), root: root, count: entries.length, failed: failed };
      });
    });
  }

  function downloadCurrentModel() {
    if (!S.model || S.downloading) return;
    // 本地导入的模型本来就是从用户上传的压缩包解出来的，再打包回去没有意义
    if (S.model._local) {
      toast('本地模型不需要打包下载', {
        type: 'info',
        detail: '它本来就是从你上传的压缩包里解出来的，原始 zip 还在你手上。'
      });
      return;
    }
    S.downloading = true;
    var btn = els.btnDownload;
    if (btn) { btn.disabled = true; btn.title = '打包中…'; }
    showOverlay('正在打包 ' + modelTitle(S.model) + ' …', '按 model3.json 的引用收集文件', false, true);

    packCurrentModel().then(function (res) {
      var url = URL.createObjectURL(res.blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = res.root + '.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      S.downloading = false;
      if (btn) { btn.disabled = false; btn.title = '下载模型（打包 zip，含 moc3 / 贴图 / 动作 / 语音）'; }
      showOverlay('已导出 ' + res.root + '.zip',
        res.count + ' 个文件 · ' + (res.blob.size / 1048576).toFixed(1) + ' MB' +
        (res.failed.length ? ' · 跳过 ' + res.failed.length + ' 个缺失文件' : ''),
        false, false);
      setTimeout(hideOverlay, 2200);
    }).catch(function (e) {
      S.downloading = false;
      if (btn) { btn.disabled = false; btn.title = '下载模型（打包 zip，含 moc3 / 贴图 / 动作 / 语音）'; }
      showOverlay('打包失败', String((e && e.message) || e), true, false);
    });
  }

  // ---------- 本地模型：上传 zip → 浏览器内解压 → 校验 → 上架 ----------
  //
  // 整条链路都在浏览器里跑，**不上传任何字节到服务器**（静态托管本来也没有后端）。
  //
  // 为什么不能把 zip 直接丢给 SDK：SDK 是按 URL 取文件的，而 zip 里的内容只在内存里，
  // 没有 URL。所以流程是
  //     解压 → 找到 model3.json → 校验 → 把 model3.json 里每一个文件引用都换成
  //     该文件自己的 blob: URL → 再把这份改好的 model3.json 也做成 blob URL
  //     → 交给 switchModel，走和远程模型完全一样的加载流程。
  //
  // ⚠️ 引用必须换成**绝对**的 blob: URL，不能保留相对路径：
  //    blob URL 之间没法互相解析相对路径（blob:http://host/<uuid> 拼上 'zhala_2.moc3'
  //    会得到 blob:http://host/zhala_2.moc3 —— 一个不存在的地址）。
  //
  // 「不符合要求就不展示」的判据（任一条不满足 → 整包拒绝，模型列表一个字都不改，
  // 当前正在预览的模型也不动，只弹提示）：
  //   · 不是合法 zip / 是 ZIP64 / 有密码 / 压缩方式不支持 / 文件头损坏
  //   · 压缩包里没有 .model3.json
  //   · model3.json 不是合法 JSON，或缺 FileReferences / FileReferences.Moc
  //   · moc3 文件缺失，或文件头不是 MOC3，或版本高于页面内置 Core 支持的 5.0
  //   · 没有贴图，或引用的贴图缺失 / 不是可识别的图片格式
  // 只警告、仍然放行的：
  //   · 部分动作缺失 → 裁掉那些动作
  //   · 物理 / 姿势 / 表情 / 语音缺失 → 裁掉引用
  //   · 一个动作都没有 → 能看静态姿势
  //   · 压缩包里有多个模型 → 取路径最外层那个，并在提示里说明

  var LOCAL_GROUP = '本地模型';
  var MAX_ZIP_BYTES = 200 * 1048576;      // 单包上限，防止把标签页撑爆
  var MAX_TOASTS = 4;

  var MOC_VERSIONS = { 1: '3.0', 2: '3.3', 3: '4.0', 4: '4.2', 5: '5.0' };

  function zipError(msg) { var e = new Error(msg); e.zipError = true; return e; }

  // ---------- 「添加外部模型源」 ----------
  //
  // 需求：把别人仓库里 models.json 的链接粘过来，自动按 owner 分组、把里面的模型
  //       全部加到侧栏。模型实际文件在那个人仓库的 models/ 子目录下，地址用
  //       「解析出的 base + 'models/' + path」拼。
  //
  // ⚠️ 与「本地预览」的区别：本地预览是把字节读进内存、用 blob URL 渲染（不出浏览器），
  //    这里走的是远端 fetch，模型资源仍在那个人的仓库里 —— 删了 / 限速就加载失败，
  //    这是设计上的取舍，不掩饰。
  //
  // 关键约束（全部踩过坑）：
  //   · 解析失败要弹错对话框，**不动 S.models** —— 一个无效 URL 不能让现有列表炸掉。
  //   · 外部模型条目要打 `_external` 标记、`key` 用 'ext:<owner>:' 前缀，避免与本仓库的
  //     key 撞；switchModel 看到 `_external` 时改走自己的 base，不再吃全局 S_modelsBase。
  //   · catch 里的「源半死自救」要按外部模型自己的源切（原始地址 ↔ 加速地址），
  //     不能动全局 S_modelsBase —— 否则一个外部仓库挂了、把整个页面的源切走了，
  //     本仓库的模型也跟着受害。
  //   · 重复加同 owner：旧的全部撤掉，新的顶上。owner 是分组的唯一标识，必须收敛。
  //   · 当前模型若在被移除的 owner 里，要切回本仓库的 S.models[0]，不能让它指向已删除的条目。
  //
  // ⚠️⚠️ 2026-09-23 起**不再支持 jsDelivr**（rain 要求下线）。能认的形态只剩两种：
  //   · GitHub 原始地址：https://raw.githubusercontent.com/<owner>/<repo>/refs/heads/<branch>/models.json
  //   · 加速地址（前缀代理）：<加速地址> + 上面那条原始地址
  //     例：https://gh-proxy.org/https://raw.githubusercontent.com/o/r/refs/heads/master/models.json
  //   于是「从一条加速 URL 里反解出 owner/repo/branch」的做法是：
  //   **先试着剥掉任一个已知加速前缀（内置清单 + 用户自加的），再去按原始地址的规则解析**。
  function parseExternalUrl(input) {
    var s = String(input || '').trim();
    if (!s) throw new Error('请填入一个 models.json 链接');

    // ① 如果带着加速前缀，先剥掉它，把它记进 accel；剩下一段按原始地址解析。
    //    ⚠️ 前缀要「贪心匹配最长的那个」：万一某加速站地址本身是另一个的前缀
    //       （例如 a.com 与 a.com/gh），短的先命中就会剥出一个非法 URL。
    //    ⚠️ 三处宽容：用户可能只写域名（不带协议）、漏了末尾斜杠、大小写混着写。
    //       这里按「归一化后的候选」逐条比对，而不是拿原串做死板的 startsWith。
    var accel = '';
    var rest = s;
    var lowS = s.toLowerCase();
    var known = knownAccelBases().slice().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < known.length; i++) {
      var k = known[i];                          // 已归一化：带协议、末尾带 /
      var variants = [k, k.replace(/\/$/, ''), k.replace(/^https?:\/\//, ''), k.replace(/^https?:\/\//, '').replace(/\/$/, '')];
      for (var j = 0; j < variants.length; j++) {
        var v = variants[j];
        if (!v || lowS.length <= v.length) continue;
        if (lowS.slice(0, v.length) === v) { accel = k; rest = s.slice(v.length); break; }
      }
      if (accel) break;
    }
    // 剥完可能剩下「/ https://raw...」带个多余斜杠（用户写了 `.../` 或我们只剥了域名）。
    rest = rest.replace(/^\/+/, '');

    var u;
    try { u = new URL(rest); } catch (e) { throw new Error('链接不是合法 URL：' + rest.slice(0, 60)); }

    var host = u.hostname.toLowerCase();
    if (host !== 'raw.githubusercontent.com') {
      if (!accel) {
        throw new Error('只支持 raw.githubusercontent.com 的 models.json 链接，'
          + '或在「加速地址」里选一个加速站/自定义加速地址。识别到的是 ' + host);
      }
      throw new Error('加速地址后面要跟完整的 raw.githubusercontent.com 原始链接，收到的是 ' + host);
    }

    // /<owner>/<repo>/refs/heads/<branch>/models.json → 过滤空段后长度 6
    //   seg[0]=owner [1]=repo [2]=refs [3]=heads [4]=branch [5]=models.json
    var seg = u.pathname.split('/').filter(Boolean);
    if (seg.length < 6 || seg[2] !== 'refs' || seg[3] !== 'heads') {
      throw new Error('raw 链接必须形如 .../<owner>/<repo>/refs/heads/<分支>/models.json');
    }
    if (seg[5] !== 'models.json') {
      throw new Error('链接末尾必须是 models.json（当前末尾是 ' + seg[5] + '）');
    }
    var owner = seg[0], repo = seg[1], branch = seg[4];
    if (!owner || !repo || !branch) throw new Error('owner / repo / branch 至少有一个解析不出来');

    var rawBase = 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/';
    // source 只有两种：'github'（原始）/ 'accel'（套了加速前缀）
    var source = accel ? 'accel' : 'github';
    var base = accel ? accelerate(rawBase, accel) : rawBase;
    return { owner: owner, repo: repo, branch: branch,
             source: source, accel: accel, base: base, url: s };
  }

  // 所有「已知的加速地址」：内置常用 + 用户自己加过的（存 localStorage）。
  // 解析 URL 时靠它把前缀剥下来；下拉框也靠它出选项。
  function knownAccelBases() {
    var out = ACCEL_PRESETS.map(function (p) { return normalizeAccelBase(p.base); });
    var pref = loadExtSrcPref();
    if (pref && pref.customAccel) {
      var c = normalizeAccelBase(pref.customAccel);
      if (c) out.push(c);
    }
    // 去重（用户可能既从下拉选了、又手填了一样的）
    var seen = {};
    return out.filter(function (b) {
      if (!b || seen[b]) return false;
      seen[b] = 1;
      return true;
    });
  }

  // 给某个外部源换一个源形态，拿不到就返回 null。
  //   github → accel：套上加速前缀（优先用该源自己的 accel，其次用当前的全局兜底）
  //   accel  → github：把前缀拆掉
  function altBase(info) {
    if (!info) return null;
    if (info.source === 'github') {
      var a = info.accel || S_accelBase || (ACCEL_PRESETS[0] && normalizeAccelBase(ACCEL_PRESETS[0].base));
      if (!a) return null;
      var rawBase = 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/' + info.branch + '/';
      return {
        owner: info.owner, repo: info.repo, branch: info.branch,
        source: 'accel', accel: a,
        base: accelerate(rawBase, a),
        url: accelerate(rawBase + 'models.json', a)
      };
    }
    if (info.source === 'accel') {
      return {
        owner: info.owner, repo: info.repo, branch: info.branch,
        source: 'github', accel: '',
        base: 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/' + info.branch + '/',
        url: 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/refs/heads/' + info.branch + '/models.json'
      };
    }
    return null;
  }

  // 拉一份外部源的 models.json。如果主源失败，自动试另一个（与 fetchWithFallback 同思路）。
  // 返回 { info, rawList }：info.base 可能是被替换过的（指向实际成功的那个源）。
  function fetchExternalModelsJson(info) {
    function attemptOnce(target) {
      // base 已经是「仓库根」末位带 /，拼 models.json 即可
      //   github → https://raw.githubusercontent.com/<owner>/<repo>/<branch>/models.json
      //   accel  → <加速地址>https://raw.githubusercontent.com/<owner>/<repo>/<branch>/models.json
      // ⚠️ 不能用 target.url + 'models.json'：用户输入的 URL 路径结构不一样
      //   （原始地址要走 refs/heads 分支目录、加速前缀还套在外面），base 是统一规范过的。
      return fetch(target.base + 'models.json', { cache: 'no-cache' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          var list = (d && d.models) || [];
          if (!list.length) throw new Error('models.json 为空');
          return { info: target, rawList: list };
        });
    }
    var other = altBase(info);
    return attemptOnce(info).catch(function (e1) {
      if (!other) throw e1;
      console.warn('[viewer] 外部源不可用，切换备用：' + info.url, e1 && e1.message);
      return attemptOnce(other).catch(function (e2) {
        var e = new Error('两个镜像都拉不到 models.json');
        e.reasons = [e1 && e1.message, e2 && e2.message].filter(Boolean);
        throw e;
      });
    });
  }

  // 把一份外部源的清单合进 S.models。
  //   · 同 owner 的旧条目全部撤掉（避免重复）
  //   · 给每条标 _external，让 switchModel 走自己的 base
  //   · key 用 'ext:<owner>:<path>/<file>' 前缀，跟本仓库的 'path/file' 区分开
  //   · group **原样保留**（清单里的文件夹路径）—— 侧栏层级由它决定；最外面那层
  //     owner 是 folderPathOf() 现加的，不写进 group（写进去就把整个仓库压成一层了）
  // 返回加进去的条目数组（按 owner 过滤后的新清单）。
  function mergeExternalModels(info, rawList) {
    var owner = info.owner;
    // 先把旧的同 owner 全部从 S.models 撤掉（如果在切换，busyModel 还在忙等稍后处理）
    for (var i = S.models.length - 1; i >= 0; i--) {
      if (S.models[i]._external && S.models[i]._external.owner === owner) {
        S.models.splice(i, 1);
      }
    }
    var added = [];
    rawList.forEach(function (raw) {
      if (!raw || !raw.file) return;     // 跳过空条目，graceful
      var m = decorate([raw])[0];         // 走正常 decorate 流程补 group/parts/key
      m._external = { owner: owner, repo: info.repo, branch: info.branch,
                      source: info.source, accel: info.accel || '',
                      base: info.base, url: info.url };
      m.key = 'ext:' + owner + ':' + m.path + '/' + m.file;
      // 拷贝信息到 decorate 漏掉的字段
      m.name = raw.name || m.name;
      S.models.push(m);
      added.push(m);
    });
    return added;
  }

  // 用户按「读取并添加」：fetch + 合进列表 + 重渲染 + 切到第一个新模型。
  // 最近一次 addExternalSource 的「选源结论」快照。见函数里写入处的注释：
  // 这个值**不能**靠事后读 S.models 里的 m._external 反推 —— switchModel 的失败重试会改写它。
  var lastAddInfo = null;

  function addExternalSource(info, onDone) {
    if (S.busyModel) {
      toast('模型正在载入，等它完事再加外部源', { type: 'warn' });
      return Promise.reject(new Error('busy'));
    }
    setSrcStatus('正在拉取 ' + info.owner + '/' + info.repo + '@' + info.branch + ' 的清单…', '');
    showOverlay('正在拉取外部清单…', info.url, false, true);
    return fetchExternalModelsJson(info).then(function (res) {
      var used = res.info;
      var added = mergeExternalModels(used, res.rawList);
      setSrcStatus('已加入 ' + added.length + ' 个模型（来自 ' + used.owner + '/' + used.repo + '，' +
        (used.source === 'accel' ? accelLabel(used.accel) + ' 加速' : 'GitHub 原始地址') + '）', '');
      showOverlay('已加入 ' + added.length + ' 个模型', used.owner + '/' + used.repo, false, true);
      renderModels();
      if (added.length) {
        // 把当前模型切到这个新组的第一项（与本地预览一致：添加完直接看）
        switchModel(added[0]);
      }
      // 短暂显示成功状态后自动关弹窗
      setTimeout(function () {
        hideOverlay();
        closeSrcDialog();
      }, 380);
      if (typeof onDone === 'function') onDone(null, { added: added, info: used });
      // 本次「解析 → 选源 → 拉清单」的结论留一份快照。⚠️ 别改用 list() 判断选源结果 ——
      // 下面的 switchModel(added[0]) 失败重试会把 m._external 的 source/base 改写成兜底源，
      // 那是「重试后的状态」，不是「本次选源的落点」。
      lastAddInfo = { source: used.source, base: used.base, accel: used.accel || '',
                      owner: used.owner, repo: used.repo, branch: used.branch, added: added.length };
      return { added: added, info: used };
    }).catch(function (e) {
      hideOverlay();
      setSrcStatus('');
      setSrcError('拉不到 models.json\n' + (e && e.message ? e.message : String(e)) +
                  (e.reasons ? '\n  · GitHub 原始: ' + (e.reasons[0] || '') +
                              '\n  · 加速地址: ' + (e.reasons[1] || '') : ''));
      if (typeof onDone === 'function') onDone(e);
      throw e;      // ⚠️ 必须再抛出去：否则调用方（以及自动化里的 .catch）以为成功了
    });
  }

  // 移除某个 owner 的所有外部模型。S.model 若在该组里，先切走再删。
  function removeExternalSource(owner) {
    if (!owner) return;
    var hit = false, currentRemoved = false;
    for (var i = S.models.length - 1; i >= 0; i--) {
      if (S.models[i]._external && S.models[i]._external.owner === owner) {
        if (S.model && S.model === S.models[i]) currentRemoved = true;
        S.models.splice(i, 1);
        hit = true;
      }
    }
    if (!hit) return;
    renderModels();
    if (currentRemoved) {
      // 切回本仓库的第一项（或任意剩余条目）；保证当前模型永远指向有效条目
      var next = null;
      for (var k = 0; k < S.models.length; k++) {
        if (!S.models[k]._external) { next = S.models[k]; break; }
      }
      if (next) switchModel(next);
      else showOverlay('没有可预览的模型了', '请再加一个外部源或刷新页面', true, false);
    }
    toast('已移除外部源 ' + owner, { type: 'info' });
  }

  function setSrcStatus(msg, detail) {
    if (!els.srcStatus) return;
    var text = msg ? (detail ? msg + ' · ' + detail : msg) : '';
    els.srcStatus.hidden = !text;
    if (els.srcStatusText) els.srcStatusText.textContent = text;
  }
  function setSrcError(msg) {
    if (!els.srcErr) return;
    els.srcErr.hidden = !msg;
    els.srcErr.textContent = msg ? String(msg) : '';
  }

  // 记住 / 取回上次填的外部源链接。存三样：URL、源形态（github / accel）、
  // 以及**用户选过的加速地址**（自加的也算，见 customAccel）——
  // 最后一个不止弹窗用：主页面的「加速兜底」也读它（rain 定的是「用上次选的那个」）。
  function loadExtSrcPref() {
    try { return JSON.parse(localStorage.getItem(EXTSRC_KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function saveExtSrcPref(url, src, accel, customAccel) {
    try {
      if (!url && !accel && !customAccel) localStorage.removeItem(EXTSRC_KEY);   // 全空 = 主动忘掉
      else localStorage.setItem(EXTSRC_KEY, JSON.stringify({
        url: url || '',
        src: (src === 'accel') ? 'accel' : 'github',
        accel: accel || '',
        customAccel: customAccel || ''
      }));
    } catch (e) { /* 隐私模式下写不进去，忽略 */ }
  }
  // 把输入框当前的内容记下来（对话框关闭 / 输入变化 / 添加成功时都调一次）
  function persistSrcUrl() {
    if (!els.srcUrl) return;
    saveExtSrcPref(els.srcUrl.value.trim(), pickedSrcKind(), pickedAccelBase(), pickedCustomAccel());
  }
  // ---------- 「源」下拉框（取代原来的 raw / jsDelivr 段控件）----------
  //
  // 选项形态：<option value="github">GitHub 原始地址</option>
  //           <option value="accel|<base>">ghproxy.net</option>
  //           <option value="custom">自定义…</option>
  // value 里带 base 是为了「一个下拉同时表达两个维度」—— 省掉一个联动控件。
  var SRC_SEL_GITHUB = 'github';
  var SRC_SEL_CUSTOM = 'custom';
  var SRC_SEL_ACCEL_PREFIX = 'accel|';

  // 下拉当前选中项的 value（防御性：拿不到就当 github）
  function pickedSrcSel() {
    if (!els.srcKind) return SRC_SEL_GITHUB;
    return els.srcKind.value || SRC_SEL_GITHUB;
  }
  // 'github' / 'accel' —— 与 info.source、偏好里的 src 字段同一套取值
  function pickedSrcKind() {
    var v = pickedSrcSel();
    if (v === SRC_SEL_GITHUB) return 'github';
    return 'accel';
  }
  // 选中的加速地址（自定义时读小输入框）；选的是 github 就返回 ''
  function pickedAccelBase() {
    var v = pickedSrcSel();
    if (v === SRC_SEL_GITHUB) return '';
    if (v === SRC_SEL_CUSTOM) return normalizeAccelBase(els.srcAccelInput && els.srcAccelInput.value);
    if (v.indexOf(SRC_SEL_ACCEL_PREFIX) === 0) return normalizeAccelBase(v.slice(SRC_SEL_ACCEL_PREFIX.length));
    return '';
  }
  // 只在「选的是自定义」时才回填那个小输入框（选了预设项就别留脏值）
  function pickedCustomAccel() {
    if (pickedSrcSel() !== SRC_SEL_CUSTOM) return '';
    return normalizeAccelBase(els.srcAccelInput && els.srcAccelInput.value);
  }

  // 把下拉切到某个加速地址上（能匹配到预设就选预设项，否则退到「自定义」）
  function applySrcAccel(accelBase) {
    if (!els.srcKind) return;
    var a = normalizeAccelBase(accelBase);
    if (!a) { els.srcKind.value = SRC_SEL_GITHUB; syncSrcAccelRow(); return; }
    var opts = els.srcKind.querySelectorAll('option');
    for (var i = 0; i < opts.length; i++) {
      var v = opts[i].value || '';
      if (v.indexOf(SRC_SEL_ACCEL_PREFIX) === 0 &&
          normalizeAccelBase(v.slice(SRC_SEL_ACCEL_PREFIX.length)) === a) {
        els.srcKind.value = v;
        syncSrcAccelRow();
        return;
      }
    }
    // 不在预设里 —— 落到「自定义」并把地址填进小输入框
    els.srcKind.value = SRC_SEL_CUSTOM;
    if (els.srcAccelInput) els.srcAccelInput.value = a;
    syncSrcAccelRow();
  }

  // 按当前下拉值显示 / 隐藏「自定义加速地址」那一行
  function syncSrcAccelRow() {
    if (!els.srcAccelRow) return;
    els.srcAccelRow.hidden = (pickedSrcSel() !== SRC_SEL_CUSTOM);
  }

  // 把内置加速站清单填进下拉框（只填一次；元素在 index.html 里是空的）。
  //   选项顺序 = ACCEL_PRESETS 的顺序，GitHub 原始地址永远排第一。
  //   用户自加的地址不在这里 —— 它走「自定义…」那一项 + 小输入框。
  function buildSrcKindOptions() {
    if (!els.srcKind || els.srcKind.dataset.built === '1') return;
    var html = '<option value="' + SRC_SEL_GITHUB + '">GitHub 原始地址（慢，但直连）</option>';
    ACCEL_PRESETS.forEach(function (p) {
      var b = normalizeAccelBase(p.base);
      if (!b) return;
      html += '<option value="' + SRC_SEL_ACCEL_PREFIX + escapeHtml(b) + '">' +
              escapeHtml(p.label) + ' 加速</option>';
    });
    html += '<option value="' + SRC_SEL_CUSTOM + '">自定义加速地址…</option>';
    els.srcKind.innerHTML = html;
    els.srcKind.dataset.built = '1';
  }

  // ============================================================
  // 「未确认就换源」的防线：弹窗打开时拍一张快照，取消 / 关闭时还原
  // ============================================================
  //
  // ⚠️⚠️ rain 2026-09-23 反馈：「只要选择或者切换加速镜像，即便不确认，都会改变」。
  //    原实现是「下拉 change → 立刻换源 + 立刻写 localStorage」，于是：
  //      · 用户只是想**看看**某个加速站叫什么，源已经被换走了（左侧列表当场改走加速）；
  //      · 点「取消」也回不来 —— change 早把偏好写进 localStorage 了；
  //      · 刷新后仍是那个加速站（因为写的是持久偏好）。
  //
  //    改成「暂存 + 确认/取消」两段式：
  //      · 下拉 / 自定义输入框变化 → 只**暂存**待生效的源，先不动 S_modelsBase，
  //        也不写持久偏好（可以随便点着看，零副作用）；
  //      · 点「读取并添加」（或真正关闭弹窗）→ 才 apply 并落盘。
  //
  // ⚠️ 快照要在**预填之前**拍，否则拍到的就是预填后的值，还原等于没还。
  var srcPending = null;      // { kind:'github'|'accel', accel:'<加速地址>' } | null
  var srcSnap = null;         // 打开弹窗那一刻的现场，取消/关闭时照着还原

  // 当前**下拉里显示**的源（不看是否已生效）——「暂存」和「提交」都读它
  function pickedSrcState() {
    return { kind: pickedSrcKind(), accel: pickedAccelBase() };
  }
  function srcStateEq(a, b) {
    if (!a || !b) return a === b;
    return a.kind === b.kind &&
           normalizeAccelBase(a.accel) === normalizeAccelBase(b.accel);
  }

  function takeSrcSnapshot() {
    srcSnap = {
      // 左端：进弹窗时列表实际用的是哪个源（还原要回到「取消时那一刻」的现场）
      base: S_modelsBase,
      baseName: S_baseName,
      cands: S_baseCandidates.slice(),
      accelBase: S_accelBase,
      // 右端：弹窗控件现场（源下拉的选中值 + 自定义地址框）
      customAccel: els.srcAccelInput ? els.srcAccelInput.value : '',
      sel: pickedSrcSel()
    };
    srcPending = null;
  }

  // 还原到快照 + 丢掉未确认的暂存。返回是否真的动过源（动过就要重画列表）。
  //
  // ⚠️⚠️ 只还原**源**（下拉选择 + 偏好里的 accel/src），**不还原 URL 输入框** ——
  //    「记住粘过的链接」是本来就要的行为，用户填了链接点取消，下次打开还该在。
  //    源则相反：没确认就不该生效，也不该被记住。这两件事必须分开处理，
  //    否则「取消」会把用户刚粘的链接也一起吞掉。
  function revertSrcDialog() {
    if (!srcSnap) { srcPending = null; return false; }
    var moved = false;
    // ⚠️ 还原基址必须走 repin，且把「原来那个加速站」**显式**传进去 ——
    //    不能指望 S_accelBase，它可能已经被暂存阶段改掉了。
    var snapAccel = normalizeAccelBase(srcSnap.accelBase);
    S_accelBase = snapAccel || S_accelBase;
    if (S_modelsBase !== srcSnap.base) {
      if (srcSnap.baseName === 'accel' && snapAccel) moved = repinModelsBase('accel', snapAccel);
      else moved = repinModelsBase('github');
      // 候选表跟着还原（repin 会 pinBranch，这里再校一次更稳）
      S_baseCandidates = srcSnap.cands.slice();
    }
    // 偏好：URL 照当前输入框**记下来**（这是该留的），但 src/accel 用快照里的
    //   —— 也就是「链接记住了、源没被改」。
    saveExtSrcPref(els.srcUrl ? els.srcUrl.value.trim() : '',
                   srcSnap.baseName === 'accel' ? 'accel' : 'github',
                   snapAccel, srcSnap.customAccel || '');
    // 控件：源下拉回到快照那一刻的选择（URL 输入框保持用户填的内容，不动）
    if (els.srcKind) els.srcKind.value = srcSnap.sel || SRC_SEL_GITHUB;
    syncSrcAccelRow();
    srcPending = null;
    srcSnap = null;
    return moved;
  }

  // 暂存：下拉 / 自定义输入框一变就调。**只记，不生效、不落盘**。
  //
  // ⚠️ 弹窗没开着时也要能暂存（探针用 setKind 直接驱动、不开弹窗）。
  //    早期版本这里写了 `if (!srcSnap) return;` —— 结果 setKind(..., commit=true)
  //    在没开弹窗时永远 commit 不动（srcPending 一直是 null），M 组 12 条齐报红。
  //    「暂存」这个动作本身不依赖弹窗是否开着。
  function stageSrcChange() {
    srcPending = pickedSrcState();
  }

  // 提交：把暂存的源真正用起来 + 落盘。返回是否动过源。
  function commitSrcChange() {
    var moved = false;
    if (srcPending) {
      // ⚠️ 先把「用户选的那个站」写进 S_accelBase，再 repin —— 顺序反了会拼到旧站上
      if (srcPending.accel) S_accelBase = normalizeAccelBase(srcPending.accel) || S_accelBase;
      moved = repinModelsBase(srcPending.kind, srcPending.accel);
    }
    persistSrcUrl();                    // 提交才记住
    srcPending = null;
    srcSnap = null;
    return moved;
  }

  function openSrcDialog() {
    if (!els.srcModal) return;
    // 手机端先把抽屉收掉，否则对话框被压在侧栏底下（见 closeNavForDialog）
    closeNavForDialog();
    buildSrcKindOptions();
    S.srcOpen = true;
    els.srcModal.hidden = false;
    setSrcStatus('');
    setSrcError('');
    // ⚠️ 快照必须在预填**之前**拍（见 takeSrcSnapshot 的注释）
    takeSrcSnapshot();
    // 预填上次填过的链接与源选择（只在输入框还空着时填 —— 用户自己清空过就别再塞回去）
    // ⚠️ 源选择（下拉）**每次都恢复**，不受「输入框空不空」约束：用户上次特意选了某个
    //    加速站，下次打开就该还是它。填完再 refreshSrcPreview 让它落到预览上。
    var pref = loadExtSrcPref();
    if (pref.url && els.srcUrl && !els.srcUrl.value) els.srcUrl.value = pref.url;
    if (pref.customAccel && els.srcAccelInput && !els.srcAccelInput.value) {
      els.srcAccelInput.value = pref.customAccel;
    }
    if (pref.accel) applySrcAccel(pref.accel);
    else if (pref.src === 'accel' && pref.customAccel) applySrcAccel(pref.customAccel);
    else if (els.srcKind) els.srcKind.value = SRC_SEL_GITHUB;
    syncSrcAccelRow();
    if (els.srcUrl && els.srcUrl.value) { try { els.srcUrl.focus(); } catch (e) {} }
    refreshSrcPreview();
    // ⚠️ 预填之后**再清一次** pending：预填是「恢复上次的选择」，不是「用户这次改的」，
    //    留着它会让「打开弹窗什么也不做 → 取消」误判成「改过源了」。
    srcPending = null;
  }
  // 关窗。默认**丢弃**未确认的改动并还原（点 × / 点遮罩 / 按 Esc 都算取消）。
  // ⚠️ 「读取并添加」成功那条路要先 commitSrcChange()，所以到这里 pending 已是 null，
  //    还原不会把它抹掉。
  function closeSrcDialog() {
    if (!els.srcModal) return;
    var moved = revertSrcDialog();
    if (moved) renderModels();        // 源被还原过 → 列表头标签要跟着回去
    S.srcOpen = false;
    els.srcModal.hidden = true;
    setSrcStatus('');
    setSrcError('');
  }

  // 输入框或源下拉变化时，重新解析并显示预览。
  // 解析规则：
  //   · URL 必须能被 parseExternalUrl 识别（原始地址，或加速地址 + 原始地址），拿 owner/repo/branch
  //   · 实际要用的源**由下拉框说了算**：用户粘原始 URL 但想走加速？选一个加速站就行，
  //     地址自动重拼（owner/repo/branch 不变）。反过来也行：粘的是加速过的链接、
  //     选「GitHub 原始地址」就自动把前缀摘掉。
  function refreshSrcPreview() {
    if (!els.srcUrl || !els.srcRepo || !els.srcBranch || !els.srcEffective) return;
    syncSrcAccelRow();
    var raw = els.srcUrl.value.trim();
    if (!raw) {
      els.srcRepo.textContent = '—';
      els.srcBranch.textContent = '—';
      els.srcEffective.textContent = '—';
      if (els.srcPreview) els.srcPreview.classList.remove('invalid');
      return;
    }
    try {
      var info = parseExternalUrl(raw);
      // 下拉强制选源 —— 用解析出的 owner/repo/branch 重新拼 base
      var kind = pickedSrcKind();
      var accel = pickedAccelBase();
      if (kind === 'github') {
        info = { owner: info.owner, repo: info.repo, branch: info.branch,
                 source: 'github', accel: '',
                 base: 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/' + info.branch + '/',
                 url: raw };
        els.srcEffective.textContent = 'raw.githubusercontent.com';
      } else {
        if (!accel) {          // 选了自定义却没填地址 —— 明确提示，别假装能用
          els.srcRepo.textContent = info.owner + ' / ' + info.repo;
          els.srcBranch.textContent = info.branch;
          els.srcEffective.textContent = '请填自定义加速地址';
          if (els.srcPreview) els.srcPreview.classList.add('invalid');
          return;
        }
        var rawBase = 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/' + info.branch + '/';
        info = { owner: info.owner, repo: info.repo, branch: info.branch,
                 source: 'accel', accel: accel,
                 base: accelerate(rawBase, accel), url: raw };
        els.srcEffective.textContent = accelLabel(accel) + '（加速）';
      }
      els.srcRepo.textContent = info.owner + ' / ' + info.repo;
      els.srcBranch.textContent = info.branch;
      if (els.srcPreview) els.srcPreview.classList.remove('invalid');
    } catch (e) {
      els.srcRepo.textContent = String((e && e.message) || e);
      els.srcBranch.textContent = '—';
      els.srcEffective.textContent = '无法解析';
      if (els.srcPreview) els.srcPreview.classList.add('invalid');
    }
  }

  // ---------- 提示条 ----------
  var TOAST_ICON = { ok: '\u2713', warn: '!', error: '\u2715', info: 'i' };

  function toastHost() {
    if (els.toastHost) return els.toastHost;
    var h = document.createElement('div');
    h.className = 'toast-host';
    els.toastHost = h;
    document.body.appendChild(h);
    return h;
  }

  function toast(msg, opts) {
    opts = opts || {};
    var type = opts.type || 'info';
    var host = toastHost();
    while (host.children.length >= MAX_TOASTS) host.removeChild(host.firstChild);

    var el = document.createElement('div');
    el.className = 'toast ' + type;
    var icon = document.createElement('div');
    icon.className = 'ti';
    icon.textContent = TOAST_ICON[type] || 'i';
    var body = document.createElement('div');
    body.className = 'tb';
    var tm = document.createElement('div');
    tm.className = 'tm';
    tm.textContent = String(msg);
    body.appendChild(tm);
    if (opts.detail) {
      var td = document.createElement('div');
      td.className = 'td';
      td.textContent = String(opts.detail);   // CSS 里 white-space:pre-line，换行直接生效
      body.appendChild(td);
    }
    var close = document.createElement('button');
    close.className = 'tx';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭提示');
    close.textContent = '\u00d7';
    el.appendChild(icon); el.appendChild(body); el.appendChild(close);

    var done = false;
    function dismiss() {
      if (done) return;
      done = true;
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }
    close.addEventListener('click', dismiss);
    // 提示条在 .stage 内部，点它会冒泡到舞台的 pointerdown 上被当成「开始拖动模型」，
    // 这里拦一下（顺便让整张卡片点哪儿都能关掉）
    el.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    el.addEventListener('click', dismiss);

    host.appendChild(el);
    // 错误多留一会儿，用户得看清原因
    setTimeout(dismiss, opts.ms || (type === 'error' ? 9000 : 5200));
    return el;
  }

  // ---------- object URL 生命周期 ----------
  // 释放的时机很讲究：模型还挂在舞台上时 revoke 掉，贴图会直接变黑。
  // 所以先排队，等旧模型真的 destroy() 之后再统一释放（见 loadIntoStage）。
  function queueRevoke(urls) {
    if (!urls || !urls.length) return;
    S._deadUrls = (S._deadUrls || []).concat(urls);
  }
  function flushRevokes() {
    var d = S._deadUrls;
    if (!d || !d.length) return;
    S._deadUrls = [];
    for (var i = 0; i < d.length; i++) {
      try { URL.revokeObjectURL(d[i]); } catch (e) {}
    }
  }

  function clearOtherModelCache() {
    if (!S.model) { toast('没有正在播放的模型', { type: 'warn' }); return; }
    // 当前模型的前缀：用来认出「哪些缓存是本模型的」。
    // ⚠️ 必须用 modelsUrl() 解析后的地址 —— 纹理缓存的 key 是**实际请求到的
    //    URL**（分离部署下是 raw/CDN 的绝对地址），拿 'models/xxx' 这种仓库内
    //    相对路径去 indexOf 永远匹配不上 → 会把当前模型的纹理也当「其他」清掉。
    //    （本地导入走 blob: 前缀，按原样处理。）
    var curPrefix = S.model._local ? null : modelsUrl('models/' + (S.model.path || ''));
    var curBlobs = {};
    if (S.model._local && S.model._local.relByUrl) {
      var rels = S.model._local.relByUrl;
      for (var b in rels) curBlobs[b] = true;
    }
    var cache = PIXI.utils.TextureCache;
    var cleared = 0;
    var keys = Object.keys(cache);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (curPrefix && k.indexOf(curPrefix) === 0) continue;
      if (curBlobs[k]) continue;
      try { cache[k].destroy(true); } catch (e) {}
      delete cache[k];
      cleared++;
    }
    flushRevokes();
    toast(cleared > 0 ? '已清除其他模型缓存（' + cleared + ' 个纹理）' : '无需清除', { type: cleared > 0 ? 'ok' : 'info' });
  }

  // ---------- zip 读取（纯前端，只依赖 DecompressionStream） ----------
  //
  // 支持的压缩方式：0 = STORE、8 = DEFLATE。
  // DEFLATE 用浏览器原生的 DecompressionStream('deflate-raw')，不需要引任何库。
  //
  // ⚠️ 一切尺寸都以**中央目录**为准，不要读本地文件头里的尺寸：
  //    很多打包工具（macOS 归档工具、部分 Java/Python 库）会置上「数据描述符」标志位，
  //    此时本地头里的压缩后大小写的是 0，真实尺寸只存在于中央目录。
  //    按本地头读会得到 0 字节的文件。

  function findEocd(dv, u8) {
    var min = Math.max(0, u8.length - 22 - 65535);   // 尾部注释最长 65535
    for (var i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  // 文件名编码：置了 bit11 就是 UTF-8；否则先按 UTF-8 试，出现替换字符再退回 GBK
  //（Windows 自带的「压缩到 zip」在老系统上写的是 GBK）
  function decodeZipName(bytes, flags) {
    if (flags & 0x0800) return new TextDecoder('utf-8').decode(bytes);
    var s = new TextDecoder('utf-8').decode(bytes);
    if (s.indexOf('\uFFFD') < 0) return s;
    try { return new TextDecoder('gbk').decode(bytes); } catch (e) { return s; }
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(zipError('当前浏览器不支持解压 deflate，请换用新版 Chrome / Edge / Firefox'));
    }
    var ds = new DecompressionStream('deflate-raw');
    return new Response(new Blob([bytes]).stream().pipeThrough(ds))
      .arrayBuffer()
      .then(function (ab) { return new Uint8Array(ab); })
      .catch(function () { throw zipError('压缩包已损坏（解压失败）'); });
  }

  // 解析 zip，resolve 出 [{ name, bytes }]，只含文件项（目录项跳过）
  function readZip(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    var dv = new DataView(arrayBuffer);
    if (u8.length < 22) throw zipError('文件太小，不是有效的 zip 压缩包');

    var eocd = findEocd(dv, u8);
    if (eocd < 0) throw zipError('这不是一个有效的 zip 压缩包（找不到中央目录）。请确认上传的是 .zip，而不是 .rar / .7z / 改过后缀名的文件。');

    var count = dv.getUint16(eocd + 10, true);
    var cdSize = dv.getUint32(eocd + 12, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
      throw zipError('不支持 ZIP64 格式的压缩包，请用普通 zip 重新压缩');
    }
    if (cdOff + cdSize > u8.length) throw zipError('压缩包已损坏（中央目录越界）');

    var raws = [], off = cdOff;
    for (var i = 0; i < count; i++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) {
        throw zipError('压缩包已损坏（中央目录项不完整）');
      }
      var flags = dv.getUint16(off + 8, true);
      var method = dv.getUint16(off + 10, true);
      var csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true);
      var elen = dv.getUint16(off + 30, true);
      var clen = dv.getUint16(off + 32, true);
      var lho = dv.getUint32(off + 42, true);
      var name = decodeZipName(u8.subarray(off + 46, off + 46 + nlen), flags);
      off += 46 + nlen + elen + clen;

      if (csize === 0xFFFFFFFF || lho === 0xFFFFFFFF) throw zipError('不支持 ZIP64 格式的压缩包');
      if (name.charAt(name.length - 1) === '/') continue;      // 目录项
      if (flags & 0x0001) throw zipError('压缩包里的「' + name + '」是加密的，请先解压再重新压缩');
      raws.push({ name: name, method: method, csize: csize, lho: lho });
    }
    if (!raws.length) throw zipError('压缩包里没有任何文件');

    // 串行解压：一个模型几十个文件，并发解压只会把内存峰值推高，也不好报进度
    var entries = [], chain = Promise.resolve();
    raws.forEach(function (r) {
      chain = chain.then(function () {
        if (dv.getUint32(r.lho, true) !== 0x04034b50) throw zipError('压缩包已损坏（本地文件头签名不对）');
        var lnlen = dv.getUint16(r.lho + 26, true);
        var lelen = dv.getUint16(r.lho + 28, true);
        var start = r.lho + 30 + lnlen + lelen;
        if (start + r.csize > u8.length) throw zipError('压缩包已损坏（文件数据越界）');
        if (r.method === 0) {
          // slice 而不是 subarray：subarray 是个视图，会让整个 zip 的 ArrayBuffer 一直活着
          return { name: r.name, bytes: u8.slice(start, start + r.csize) };
        }
        if (r.method !== 8) throw zipError('压缩包里用了不支持的压缩方式（method ' + r.method + '），请用普通 zip 重新压缩');
        return inflateRaw(u8.subarray(start, start + r.csize)).then(function (b) {
          return { name: r.name, bytes: b };
        });
      }).then(function (e) { entries.push(e); });
    });
    return chain.then(function () { return entries; });
  }

  // ---------- 路径工具 ----------
  // 统一成 'a/b/c' 形式：反斜杠转正斜杠、去掉 '.' 与空段、就地消化 '..'
  function normPath(p) {
    var parts = String(p).replace(/\\/g, '/').split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (!s || s === '.') continue;
      if (s === '..') { out.pop(); continue; }
      out.push(s);
    }
    return out.join('/');
  }

  // 压缩包里常见的垃圾文件：macOS 的 __MACOSX 与 ._ 资源叉、Windows 的 Thumbs.db 等
  function isJunkPath(p) {
    if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(p)) return true;
    var base = p.split('/').pop();
    return base.charAt(0) === '.';
  }

  function depthOf(p) { return p.split('/').length; }
  // 文件名是否与所在目录同名（zhala_2/zhala_2.model3.json）—— 常见的导出约定
  function sameAsDir(p) {
    var parts = p.split('/');
    if (parts.length < 2) return false;
    var base = parts[parts.length - 1].replace(/\.model3\.json$/i, '');
    return base.toLowerCase() === parts[parts.length - 2].toLowerCase();
  }

  function mimeOf(name) {
    var ext = String(name).split('.').pop().toLowerCase();
    return {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
      json: 'application/json', moc3: 'application/octet-stream'
    }[ext] || 'application/octet-stream';
  }

  function readMocVersion(bytes) {
    if (!bytes || bytes.length < 8) return null;
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'MOC3') return null;
    return bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  }

  // 贴图是不是可识别的图片：只认 Cubism 能解码的那几种。
  // 这条能挡住「压缩包截断 / 文件被替换成占位文本」这类坏包 ——
  // 否则要等到 SDK 解码失败才报错，那时给不出有用的原因。
  function looksLikeImage(b) {
    if (!b || b.length < 12) return false;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;   // PNG
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;                   // JPEG
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;   // GIF
    if (b[0] === 0x42 && b[1] === 0x4D) return true;                                     // BMP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WebP
    return false;
  }

  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

  // ---------- 挑出要用的那个 model3.json ----------
  function pickModelJson(entries) {
    var cands = entries.filter(function (e) {
      return /\.model3\.json$/i.test(e.name) && !isJunkPath(e.name);
    });
    if (!cands.length) {
      throw zipError('压缩包里没有 .model3.json —— 请确认压缩的是完整的模型文件夹' +
                     '（里面要有 xxx.model3.json、xxx.moc3、贴图文件夹等）');
    }
    cands.sort(function (a, b) {
      var da = depthOf(a.name), db = depthOf(b.name);
      if (da !== db) return da - db;                       // 越靠外层越可能是模型本体
      var ma = sameAsDir(a.name), mb2 = sameAsDir(b.name);
      if (ma !== mb2) return ma ? -1 : 1;                  // 再优先「文件名与目录同名」的
      return a.name < b.name ? -1 : 1;
    });
    return { chosen: cands[0], total: cands.length };
  }

  // ---------- 校验 + 改写引用，产出可直接上架的模型条目 ----------
  function prepareLocalModel(entries, fileName) {
    var picked = pickModelJson(entries);
    var chosen = picked.chosen;
    var rootDir = chosen.name.indexOf('/') < 0 ? '' : chosen.name.slice(0, chosen.name.lastIndexOf('/'));

    var byPath = {}, lower = {};
    entries.forEach(function (e) {
      var n = normPath(e.name);
      byPath[n] = e;
      lower[n.toLowerCase()] = n;
    });

    // 把模型里的相对引用解析成压缩包内的真实路径。
    // 只做「精确匹配」和「忽略大小写匹配」——不做「按文件名兜底」：
    // 兜底可能匹配到同名的另一个文件（比如两张同名贴图），画面会错得很隐蔽，
    // 不如直接报「缺少 xxx」让用户去检查压缩包。
    function find(ref) {
      if (!ref || typeof ref !== 'string') return null;
      var r = normPath(ref);
      if (!r) return null;
      var full = rootDir ? normPath(rootDir + '/' + r) : r;
      if (byPath[full]) return byPath[full];
      var lo = lower[full.toLowerCase()];
      return lo ? byPath[lo] : null;
    }

    var mf;
    try {
      mf = JSON.parse(new TextDecoder('utf-8').decode(chosen.bytes));
    } catch (e) {
      throw zipError('模型配置 ' + chosen.name + ' 不是合法的 JSON，压缩包可能已损坏');
    }
    var fr = mf && mf.FileReferences;
    if (!fr || typeof fr !== 'object') throw zipError('模型配置里没有 FileReferences，这不是一个 Live2D 模型');
    if (!fr.Moc) throw zipError('模型配置里没有指定 moc3 主体文件（FileReferences.Moc 缺失）');

    // --- 硬性要求 1：moc3 主体 ---
    var mocEntry = find(fr.Moc);
    if (!mocEntry) throw zipError('压缩包里缺少模型主体文件 ' + fr.Moc + '，请确认压缩的是完整文件夹');
    var mocVer = readMocVersion(mocEntry.bytes);
    if (mocVer === null) {
      throw zipError(mocEntry.name + ' 不是有效的 moc3 文件（文件头不是 MOC3），压缩包可能已损坏');
    }
    if (mocVer < 1) throw zipError(mocEntry.name + ' 的 moc3 版本号异常，压缩包可能已损坏');
    if (mocVer > 5) {
      throw zipError('这个模型用的是更新的 Cubism 版本（moc3 v' + mocVer + '），' +
                     '页面内置的 Cubism Core 只支持到 5.0，无法预览');
    }

    // --- 硬性要求 2：贴图 ---
    var texRefs = fr.Textures || [];
    if (!texRefs.length) throw zipError('模型配置里没有贴图（FileReferences.Textures 为空），无法预览');
    var missTex = [], badTex = [];
    texRefs.forEach(function (t) {
      var e = find(t);
      if (!e) { missTex.push(String(t)); return; }
      if (!looksLikeImage(e.bytes)) badTex.push(String(t));
    });
    if (missTex.length) {
      throw zipError('压缩包里缺少 ' + missTex.length + ' 张贴图：\n· ' +
                     missTex.slice(0, 5).join('\n· ') + (missTex.length > 5 ? '\n· …' : ''));
    }
    if (badTex.length) {
      throw zipError('贴图不是可识别的图片格式（png / jpg / webp / gif / bmp）：\n· ' +
                     badTex.slice(0, 5).join('\n· ') + (badTex.length > 5 ? '\n· …' : ''));
    }

    // --- 软性：其余引用缺失就裁掉，不阻断整体 ---
    var urls = [], relByUrl = {}, dropped = [];
    function toUrl(entry) {
      var u = URL.createObjectURL(new Blob([entry.bytes], { type: mimeOf(entry.name) }));
      urls.push(u);
      return u;
    }

    // 「贡献模型」上传要用的原始文件表 {rel, bytes}。
    // ⚠️ 必须是**原始**字节：下面那份改写过的 model3.json 里每个引用都被换成了 blob: 地址，
    //    传到仓库里就是一堆指向本机内存的死链接，模型根本打不开。
    //    rel 是 zip 内相对模型根目录的路径，上传时原样拼到目标目录下，目录结构才不会走形。
    var uploadFiles = [], seenRel = {};
    function keep(rel, bytes) {
      var r = normPath(rel);
      if (!r || seenRel[r]) return;          // 同一张贴图被多处引用时只留一份
      seenRel[r] = true;
      uploadFiles.push({ rel: r, bytes: bytes });
    }
    // model3.json 自己放第一个（清单里看着顺），同样用未改写的原始字节
    keep(chosen.name.slice(rootDir ? rootDir.length + 1 : 0), chosen.bytes);

    function put(ref) {
      var e = find(ref);
      if (!e) { dropped.push(String(ref)); return null; }
      var u = toUrl(e);
      relByUrl[u] = normPath(ref);
      keep(ref, e.bytes);
      return u;
    }
    function cloneWith(o, k, v) { var c = {}; for (var p in o) c[p] = o[p]; c[k] = v; return c; }

    var out = {};
    for (var key in mf) out[key] = mf[key];
    var ofr = {};
    for (var k2 in fr) ofr[k2] = fr[k2];
    out.FileReferences = ofr;

    ofr.Moc = put(fr.Moc);
    ofr.Textures = texRefs.map(function (t) { return put(t); }).filter(Boolean);

    ['Physics', 'Pose', 'UserData', 'DisplayInfo'].forEach(function (k) {
      if (!fr[k]) return;
      var u = put(fr[k]);
      if (u) ofr[k] = u; else delete ofr[k];
    });

    if (fr.Expressions) {
      var exps = [];
      fr.Expressions.forEach(function (ex) {
        if (!ex || !ex.File) return;
        var u = put(ex.File);
        if (u) exps.push(cloneWith(ex, 'File', u));
      });
      ofr.Expressions = exps;
    }

    var motionCount = 0;
    if (fr.Motions) {
      var mg = {};
      Object.keys(fr.Motions).forEach(function (g) {
        var list = [];
        (fr.Motions[g] || []).forEach(function (mo) {
          if (!mo || !mo.File) return;
          var u = put(mo.File);
          if (!u) return;
          var cp = cloneWith(mo, 'File', u);
          if (mo.Sound) {
            var su = put(mo.Sound);
            if (su) cp.Sound = su; else delete cp.Sound;
          }
          list.push(cp);
        });
        mg[g] = list;
        motionCount += list.length;
      });
      ofr.Motions = mg;
    }

    var jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    urls.push(jsonUrl);

    var modelName = chosen.name.split('/').pop().replace(/\.model3\.json$/i, '');

    return {
      path: 'local/' + modelName,
      file: chosen.name.split('/').pop(),
      model: chosen.name.split('/').pop(),
      name: modelName,
      group: LOCAL_GROUP,
      motions: motionCount,
      textures: ofr.Textures.length,
      mocVersion: MOC_VERSIONS[mocVer] || ('v' + mocVer),
      key: 'local:' + modelName,
      missing: [],
      _local: {
        jsonUrl: jsonUrl,
        urls: urls,
        relByUrl: relByUrl,
        files: uploadFiles,     // 上传用：{rel, bytes}，原始未改写
        dropped: dropped,
        from: chosen.name,
        candidates: picked.total
      }
    };
  }

  // ---------- 上架 / 移除 ----------
  function releaseLocal(m) {
    if (!m || !m._local) return;
    m._local.urls = [];
    m._local.files = null;   // 几十 MB 的原始字节，模型撤下来之后就没用了，放开好让 GC 收走
  }

  function addLocalModel(entry) {
    // 同名的本地模型只留一份：先把旧的撤下来（否则列表里会出现两个一模一样的）
    for (var i = S.models.length - 1; i >= 0; i--) {
      if (S.models[i].key === entry.key) {
        queueRevoke(S.models[i]._local.urls);
        releaseLocal(S.models[i]);
        S.models.splice(i, 1);
      }
    }
    S.models.push(entry);
    renderModels();
    refreshContribBtn();     // 有本地模型了 → 「贡献模型」按钮解禁
    return switchModel(entry);
  }

  function removeLocalModel(key) {
    var idx = -1;
    for (var i = 0; i < S.models.length; i++) {
      if (S.models[i].key === key) { idx = i; break; }
    }
    if (idx < 0) return;
    var m = S.models[idx];
    if (!m._local) return;
    var isCurrent = !!(S.model && S.model.key === key);
    S.models.splice(idx, 1);
    releaseLocal(m);

    if (isCurrent) {
      // 还挂在舞台上，blob URL 不能马上 revoke（贴图会变黑）。
      // 排队，等 loadIntoStage 里 destroy 掉旧模型之后统一释放。
      queueRevoke(m._local.urls);
      var next = S.models[Math.min(idx, S.models.length - 1)] || S.models[0] || null;
      renderModels();
      if (next) switchModel(next);
      else showOverlay('没有可预览的模型了', '', true, false);
    } else {
      queueRevoke(m._local.urls);
      flushRevokes();
      renderModels();
    }
    toast('已移除本地模型 ' + m.name, { type: 'info' });
    refreshContribBtn();     // 本地模型没了 → 「贡献模型」按钮重新禁用
  }

  // ---------- 「本地预览」对话框 ----------
  //
  // 三种进来方式，最后都汇到同一个 handleLocalZip()：
  //   · 点左下角「本地预览」→ 打开对话框
  //   · 对话框里点虚线框（或按回车 / 空格）→ 打开系统文件框
  //   · 把文件拖到对话框任意位置 → 直接处理
  //
  // ⚠️ 对话框挂在 .stage 里而不是 body 上：全屏时舞台才是整屏，挂外面会看不见。
  //    代价是它会吃到舞台的 pointerdown（被当成「开始拖动模型」），所以要拦冒泡。
  // ⚠️ 拖拽监听挂在**整个对话框**上，不能只挂虚线框：用户按住文件往中间一放，
  //    落点十有八九在下面的要求清单上，只挂虚线框就会「拖了没反应」。
  function openLocalDialog() {
    if (!els.localModal) return;
    // 手机端先把抽屉收掉 —— 入口（侧栏底部那个通栏按钮）就在抽屉里，
    // 不收的话对话框整个被压在侧栏底下（见 closeNavForDialog）
    closeNavForDialog();
    S.localOpen = true;
    els.localModal.hidden = false;
    setLocalError('');
    setLocalStatus('');
    // 打开就把焦点交给虚线框，键盘用户可以直接回车选文件
    if (els.localDrop) { try { els.localDrop.focus(); } catch (e) {} }
  }

  function closeLocalDialog() {
    if (!els.localModal) return;
    S.localOpen = false;
    els.localModal.hidden = true;
    dropHighlight(false);
    setLocalError('');
    setLocalStatus('');
    if (els.fileLocal) els.fileLocal.value = '';
  }

  function dropHighlight(on) {
    if (els.localDrop) els.localDrop.classList.toggle('over', !!on);
  }

  function setLocalStatus(msg, detail) {
    if (!els.localStatus) return;
    var text = msg ? (detail ? msg + ' · ' + detail : msg) : '';
    els.localStatus.hidden = !text;
    if (els.localStatusText) els.localStatusText.textContent = text;
  }

  function setLocalError(msg) {
    if (!els.localErr) return;
    els.localErr.hidden = !msg;
    els.localErr.textContent = msg ? String(msg) : '';
  }

  // 处理中的进度写两处：
  //   · 对话框里的状态条 —— 对话框开着时用户看的是它；
  //   · 舞台遮罩 —— 用户中途把对话框关了，也还能看到进度。
  function localProgress(msg, detail) {
    setLocalStatus(msg, detail);
    showOverlay(msg, detail, false, true);
  }

  // 从 DataTransfer 里挑第一个文件（拖拽进来的文件从这儿拿）
  function firstFile(dt) {
    if (!dt) return null;
    if (dt.files && dt.files.length) return dt.files[0];
    if (dt.items && dt.items.length) {
      for (var i = 0; i < dt.items.length; i++) {
        var it = dt.items[i];
        if (it && it.kind === 'file' && typeof it.getAsFile === 'function') {
          var f = it.getAsFile();
          if (f) return f;
        }
      }
    }
    return null;
  }

  // 早退的两种拒绝（后缀不对 / 体积超限）：对话框里写原因 + 弹提示条，其余状态一律不动
  function rejectZip(msg, detail) {
    setLocalError(msg + '\n' + detail);
    toast(msg, { type: 'error', detail: detail });
  }

  function bindLocalDialog() {
    if (!els.localModal) return;

    // 点左下角入口 → 开对话框（注意：不是直接弹系统文件框）
    if (els.btnLocal) els.btnLocal.addEventListener('click', openLocalDialog);
    if (els.localClose) els.localClose.addEventListener('click', closeLocalDialog);
    if (els.localMask) els.localMask.addEventListener('click', closeLocalDialog);

    // 对话框在 .stage 里：pointerdown / wheel 都会冒泡去拖动、缩放模型，拦掉
    els.localModal.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    els.localModal.addEventListener('wheel', function (ev) { ev.stopPropagation(); }, { passive: true });

    // 点虚线框 / 回车 / 空格 → 打开系统文件框
    if (els.localDrop) {
      els.localDrop.addEventListener('click', function () {
        if (els.fileLocal) els.fileLocal.click();
      });
      els.localDrop.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (els.fileLocal) els.fileLocal.click();
        }
      });
    }

    if (els.fileLocal) {
      els.fileLocal.addEventListener('change', function () {
        var f = els.fileLocal.files && els.fileLocal.files[0];
        // ⚠️ 必须先把 value 清掉，否则用户再选「同一个文件」时不会再触发 change。
        //    清 value 不会让上面拿到的 File 对象失效，它仍然指向那份文件。
        els.fileLocal.value = '';
        handleLocalZip(f);
      });
    }

    // ---- 拖拽 ----
    // dragenter / dragleave 会随着经过子元素反复触发，用计数器判断「真的离开了」，
    // 否则指针一滑过要求清单里的某一行，高亮就会闪一下。
    var dragDepth = 0;
    els.localModal.addEventListener('dragenter', function (ev) {
      ev.preventDefault();
      dragDepth++;
      dropHighlight(true);
    });
    els.localModal.addEventListener('dragover', function (ev) {
      // 不 preventDefault 的话浏览器不会派发 drop，而是直接打开这个 zip
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      dropHighlight(true);
    });
    els.localModal.addEventListener('dragleave', function (ev) {
      ev.preventDefault();
      // relatedTarget 为 null = 指针离开了整个窗口。这种「拖出去就不回来了」的情况
      // 浏览器不保证补发最后一次 dragleave，计数器会停在 >0 上，高亮就一直挂着。
      // 所以这里直接把计数清零。
      if (ev.relatedTarget) dragDepth = Math.max(0, dragDepth - 1);
      else dragDepth = 0;
      if (!dragDepth) dropHighlight(false);
    });
    els.localModal.addEventListener('drop', function (ev) {
      ev.preventDefault();
      dragDepth = 0;
      dropHighlight(false);
      handleLocalZip(firstFile(ev.dataTransfer));
    });
  }

  // 拖到页面别处也不能让浏览器直接打开这个 zip —— 那会把整个预览页顶掉。
  // 只拦「带文件」的拖拽，不影响页面里其它拖拽行为。
  function guardFileDrop() {
    function hasFiles(ev) {
      var dt = ev.dataTransfer;
      if (!dt || !dt.types) return false;
      for (var i = 0; i < dt.types.length; i++) if (dt.types[i] === 'Files') return true;
      return false;
    }
    window.addEventListener('dragover', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
    window.addEventListener('drop', function (ev) { if (hasFiles(ev)) ev.preventDefault(); });
  }

  function setLocalBtnBusy(on) {
    if (els.btnLocal) els.btnLocal.disabled = !!on;
    // ⚠️ 只改文字节点，别写 els.btnLocal.textContent —— 那会把按钮里的图标一起抹掉
    if (els.btnLocalText) els.btnLocalText.textContent = on ? '处理中…' : '本地预览';
  }

  // ==================================================================
  // 贡献模型：把本机预览成功的模型上传到仓库 models/用户上传/<模型名>/
  //
  // 为什么走 Git Data API 而不是逐个 PUT contents：
  //   PUT contents 每写一个文件就是**一次 commit** —— 三十几个文件就是三十几条提交，
  //   中途失败还会留下半截目录。Git Data API 是「每个文件单独建 blob → 一次建 tree →
  //   一次 commit → 移动分支指针」，整包要么全上要么全不上，历史里只多一条提交。
  //   同时它仍然满足「单文件上传」：每个文件是单独 POST 上去的一个 blob。
  //
  // ⚠️ 令牌的边界：只在下面这几个函数里出现，
  //    绝不进 S / saveState() / console / 任何对外文案（文案一律过 sanitizeToken）。
  // ==================================================================
  var CONTRIB_CONCURRENCY = 3;    // blob 并发数：太大容易撞上 GitHub 的速率限制
  var CONTRIB_TREE_MAX = 100;     // tree API 单次条目上限

  function contribTarget(m) {
    return 'models/' + CONTRIB_DIR + '/' + (m && m.name ? m.name : '');
  }

  // 令牌一旦出现在提示里就是泄露 —— 所有对外文案都要过这一道
  function sanitizeToken(s) {
    var out = String(s == null ? '' : s);
    if (contribTokenMem && contribTokenMem.length >= 6) out = out.split(contribTokenMem).join('***');
    return out.replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]+/g, '***');
  }

  // 大文件不能 btoa(String.fromCharCode(...bytes))：参数太多会爆栈，分块拼
  function bytesToBase64(bytes) {
    var out = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    }
    return btoa(out);
  }

  function parseRepoPair(s) {
    var v = String(s == null ? '' : s).trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(v)) return null;
    var p = v.split('/');
    return { owner: p[0], repo: p[1] };
  }

  // 对话框里手填的那个（改动即时生效，syncContribPreview 会跟着变）
  function manualRepoPair() {
    return els.contribRepo ? parseRepoPair(els.contribRepo.value) : null;
  }

  // 兜底建议值：项目自己的仓库。**只用来预填输入框**，不做静默兜底 ——
  // 认不出仓库时必须让用户看见并确认，不能闷头传（传错仓库 = 把几十 MB 推到别人家）。
  function suggestedRepoPair() {
    var m = /github\.com\/([^/]+)\/([^/]+)/.exec(REPO_URL);
    return m ? { owner: m[1], repo: m[2].replace(/\.git$/, '') } : null;
  }

  // 要传到哪个仓库，以及「这个结论是怎么来的」（source 决定对话框里锁不锁）。
  //   1) ?repo=owner/name —— URL 里显式指定（本地开发 / 自动化验收）
  //   2) 对话框里手填的     —— 推不出仓库时用户自己填
  //   3) *.github.io 推断   —— 部署在 GitHub Pages 上，页面自己认出所在仓库
  //   4) 以上都没有 → null，对话框逼用户填
  // auto = true 表示「页面自己认出来的」，对话框把它显示成只读一行。
  function contribRepoInfo() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('repo'); } catch (e) {}
    var fromQuery = parseRepoPair(q);
    if (fromQuery) return { owner: fromQuery.owner, repo: fromQuery.repo, source: 'query', auto: true };
    var manual = manualRepoPair();
    if (manual) return { owner: manual.owner, repo: manual.repo, source: 'manual', auto: false };
    var info = inferRepo();
    if (info && info.owner && info.repo) return { owner: info.owner, repo: info.repo, source: 'pages', auto: true };
    return { owner: '', repo: '', source: 'none', auto: false };
  }

  function contribRepo() {
    var r = contribRepoInfo();
    return (r.owner && r.repo) ? { owner: r.owner, repo: r.repo } : null;
  }

  function contribApi() {
    var r = contribRepo();
    return r ? ('https://api.github.com/repos/' + r.owner + '/' + r.repo) : null;
  }

  function contribRepoLabel() {
    var r = contribRepo();
    return r ? (r.owner + '/' + r.repo) : '（未知仓库）';
  }

  // 统一发 GitHub 请求：只带 Bearer，非 2xx 抛出带 GitHub message 的错误
  function ghReq(pathOrUrl, token, opts) {
    var api = contribApi();
    var url = /^https?:/i.test(pathOrUrl) ? pathOrUrl : (api + pathOrUrl);
    var o = opts || {};
    var headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;      // 令牌只出现在这里
    if (o.body) headers['Content-Type'] = 'application/json';
    var init = { method: o.method || 'GET', headers: headers };
    if (o.body) init.body = JSON.stringify(o.body);
    return fetch(url, init).then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!r.ok) {
          var msg = (j && j.message) ? j.message : ('HTTP ' + r.status);
          if (r.status === 401) msg = '令牌无效或已过期（401）';
          else if (r.status === 403) msg = '令牌没有这个仓库的写权限，或者触发了速率限制（403）';
          else if (r.status === 422) msg = 'GitHub 拒绝了这个请求（422）：' + msg;
          var err = new Error(sanitizeToken(msg));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  // 逐文件单独 POST 成一个 blob —— 这就是「单文件上传」，小并发避免撞速率限制
  function uploadBlobs(token, files, onEach) {
    var shas = new Array(files.length);
    var next = 0, done = 0;
    function one(i) {
      return ghReq('/git/blobs', token, {
        method: 'POST',
        body: { content: bytesToBase64(files[i].bytes), encoding: 'base64' }
      }).then(function (b) {
        if (!b || !b.sha) throw new Error('文件 ' + files[i].rel + ' 上传失败（没拿到 blob sha）');
        shas[i] = b.sha;
        done++;
        if (onEach) onEach(done);
      });
    }
    function worker() {
      if (next >= files.length) return Promise.resolve();
      var i = next++;
      return one(i).then(worker);
    }
    var ws = [], n = Math.min(CONTRIB_CONCURRENCY, files.length);
    for (var k = 0; k < n; k++) ws.push(worker());
    return Promise.all(ws).then(function () { return shas; });
  }

  // ---------- models.json：上传时一并更新（和模型文件同一个 commit） ----------
  //
  // 只传文件不更新清单的话，仓库那边要等下一次跑 models_tool.py 才认得这个模型；
  // 一起提交就能立刻生效。⚠️ 字段必须和 models_tool.py 一字不差
  // （path/file/name/group/parts/motions/motionGroups/textures/mocVersion/size/missing），
  // 否则 Actions 下次全量重建时会把整份清单重写一遍，diff 里全是噪音。

  // GitHub 的 contents API 把文件内容放在 base64 里（还带换行），先还原成文本
  function b64ToText(s) {
    var bin = atob(String(s == null ? '' : s).replace(/\s/g, ''));
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(u);
  }

  function textToBytes(s) { return new TextEncoder().encode(s); }

  // 给刚上传的模型造一条清单记录。model3.json 的原始字节就在 files 里，
  // 直接解出来读 FileReferences —— 比拿页面里那份（可能被改写过）准。
  function contribIndexEntry(m, files) {
    var settings = null;
    for (var i = 0; i < files.length; i++) {
      if (!/\.model3\.json$/i.test(files[i].rel)) continue;
      try { settings = JSON.parse(new TextDecoder('utf-8').decode(files[i].bytes)); } catch (e) { settings = null; }
      if (settings) break;
    }
    var fr = (settings && settings.FileReferences) || {};
    var moc = fr.Moc || '';
    var texs = fr.Textures || [];
    var motions = fr.Motions || {};

    var groups = Object.keys(motions).filter(function (k) {
      return (motions[k] || []).length > 0;
    }).sort();
    var motionCount = 0;
    groups.forEach(function (k) { motionCount += (motions[k] || []).length; });

    // missing 与 models_tool.py 同口径：Moc / Textures 里引用了但压缩包里没有的
    var rels = {};
    files.forEach(function (f) { rels[f.rel] = true; });
    var missing = [];
    [].concat(moc ? [moc] : [], texs).forEach(function (p) {
      if (p && !rels[p]) missing.push(p);
    });

    // size 也同口径：只算 moc + 纹理（动作 / 物理那些不算）
    var size = 0;
    files.forEach(function (f) {
      if ((moc && f.rel === moc) || texs.indexOf(f.rel) >= 0) size += f.bytes.length;
    });

    return {
      path: CONTRIB_DIR + '/' + m.name,
      file: m.file || (m.name + '.model3.json'),
      name: m.name,
      group: CONTRIB_DIR,
      parts: [CONTRIB_DIR, m.name],
      motions: motionCount || m.motions || 0,
      motionGroups: groups,
      textures: texs.length || m.textures || 0,
      mocVersion: m.mocVersion || '',
      size: size,
      missing: missing
    };
  }

  // 并进已有清单：同 path+file 的替换掉，没有就追加，最后按 models_tool.py 的规则排序
  function mergeContribIndex(index, entry) {
    var models = (index && index.models) || [];
    var key = entry.path + '/' + entry.file;
    var hit = -1;
    for (var i = 0; i < models.length; i++) {
      if ((models[i].path + '/' + models[i].file) === key) { hit = i; break; }
    }
    if (hit >= 0) models[hit] = entry; else models.push(entry);
    models.sort(function (a, b) {
      var ga = String(a.group || '').toLowerCase(), gb = String(b.group || '').toLowerCase();
      if (ga !== gb) return ga < gb ? -1 : 1;
      var na = String(a.name || '').toLowerCase(), nb = String(b.name || '').toLowerCase();
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });
    return { version: 1, count: models.length, models: models };
  }

  // 序列化要和 models_tool.py 的产物一致：indent=2、不转义非 ASCII、结尾一个 \n
  function serializeIndex(index) {
    return JSON.stringify(index, null, 2) + '\n';
  }

  function uploadModelToRepo(m, token, onProgress) {
    if (!contribApi()) {
      return Promise.reject(new Error('认不出要传到哪个仓库 —— 在对话框里填上「用户名/仓库名」'));
    }
    var files = (m._local && m._local.files) || [];
    if (!files.length) return Promise.reject(new Error('这个模型没有可上传的文件（可能已被移除）'));
    // +1 是 models.json —— 它也要占一条 tree 条目
    if (files.length + 1 > CONTRIB_TREE_MAX) {
      return Promise.reject(new Error('文件太多（' + files.length + ' 个），一次最多传 ' +
        (CONTRIB_TREE_MAX - 1) + ' 个，请把压缩包精简一下'));
    }

    var dir = contribTarget(m), branch = null, baseCommit = null, baseTree = null, baseIndex = null;
    function step(t) { if (onProgress) onProgress(t); }

    // 1) 默认分支
    step('读取仓库信息…');
    return ghReq('', token).then(function (repo) {
      branch = repo && repo.default_branch;
      if (!branch) throw new Error('读不到仓库的默认分支');
      // 2) 分支当前指向的 commit
      step('读取分支 ' + branch + ' …');
      return ghReq('/git/ref/heads/' + encodeURIComponent(branch), token);
    }).then(function (ref) {
      baseCommit = ref && ref.object && ref.object.sha;
      if (!baseCommit) throw new Error('读不到分支当前指向的提交');
      // 3) 目标目录冲突检查（404 = 不存在 = 可以传）
      step('检查目标目录…');
      var p = '/contents/' + dir.split('/').map(encodeURIComponent).join('/');
      return ghReq(p, token).then(function (existing) {
        // 目录已存在 → 拒绝，免得把别人的模型覆盖掉一半
        throw new Error('仓库里已经有 ' + dir + ' 了 —— 换一个模型名，或者让仓库主人先删掉');
      }, function (e) {
        if (e && e.status === 404) return null;
        throw e;
      });
    }).then(function () {
      // 4) 读仓库根的 models.json —— 新模型要并进清单，跟文件一起提交。
      //    ⚠️ 必须放在传文件**之前**：读不到就当场失败，别白传几十 MB 再报错。
      step('读取 models.json…');
      return ghReq('/contents/models.json?ref=' + encodeURIComponent(branch), token).then(function (f) {
        var idx = null;
        try { idx = JSON.parse(b64ToText(f && f.content)); } catch (e) { idx = null; }
        // ⚠️⚠️ 读到了却解析不了 = 仓库里那份是坏的。**绝不能拿空清单顶上** ——
        //    那等于把仓库里所有已有模型一次性从清单里抹掉。宁可整包失败，让用户先去修。
        if (!idx || !Array.isArray(idx.models)) {
          throw new Error('仓库里的 models.json 不是合法 JSON（或没有 models 数组）——' +
            '先把它修好再上传，否则已收录的模型会被整份抹掉');
        }
        return idx;
      }, function (e) {
        // 404 = 仓库里还没有清单 —— 那就从空清单开始造一份（这是安全的：本来就没内容可丢）
        if (e && e.status === 404) return { version: 1, count: 0, models: [] };
        throw e;
      });
    }).then(function (index) {
      // 5) 基树（新 tree 要挂在它上面）
      baseIndex = index;
      return ghReq('/git/trees/' + encodeURIComponent(branch), token);
    }).then(function (tree) {
      baseTree = tree && tree.sha;
      if (!baseTree) throw new Error('读不到分支的目录树');
      // 6) blobs：模型文件 + 更新后的 models.json（末尾那一个）
      var nextIndex = mergeContribIndex(baseIndex, contribIndexEntry(m, files));
      var idxBytes = textToBytes(serializeIndex(nextIndex));
      var all = files.concat([{ rel: 'models.json', bytes: idxBytes }]);
      step('上传文件 0/' + all.length + ' …');
      return uploadBlobs(token, all, function (done) {
        step('上传文件 ' + done + '/' + all.length + ' …');
      }).then(function (shas) {
        return { modelShas: shas.slice(0, files.length), indexSha: shas[files.length] };
      });
    }).then(function (r2) {
      // 7) 一次建 tree：path 就是「目标目录 + zip 内的原始相对路径」，结构由此原样保留；
      //    models.json 单独落在仓库根。
      step('生成目录树…');
      var items = [];
      for (var i = 0; i < files.length; i++) {
        items.push({ path: dir + '/' + files[i].rel, mode: '100644', type: 'blob', sha: r2.modelShas[i] });
      }
      items.push({ path: 'models.json', mode: '100644', type: 'blob', sha: r2.indexSha });
      return ghReq('/git/trees', token, {
        method: 'POST', body: { base_tree: baseTree, tree: items }
      }).then(function (t) {
        return { treeSha: t && t.sha, count: items.length };
      });
    }).then(function (r) {
      if (!r.treeSha) throw new Error('生成目录树失败');
      // 8) 一次 commit（模型文件 + models.json 在同一个提交里）
      step('创建提交…');
      return ghReq('/git/commits', token, {
        method: 'POST',
        body: {
          message: 'Add model ' + m.name + ' (' + files.length + ' files) and update models.json via web uploader',
          tree: r.treeSha,
          parents: [baseCommit]
        }
      });
    }).then(function (cm) {
      var sha = cm && cm.sha;
      if (!sha) throw new Error('创建提交失败');
      // 9) 移动分支指针
      step('更新分支…');
      return ghReq('/git/refs/heads/' + encodeURIComponent(branch), token, {
        method: 'PATCH', body: { sha: sha }
      }).then(function () {
        return { commit: sha, branch: branch, dir: dir, count: files.length, indexUpdated: true };
      });
    });
  }

  // ---------- 贡献对话框 ----------
  function localModelList() {
    return (S.models || []).filter(function (m) {
      return !!(m && m._local && m._local.files && m._local.files.length);
    });
  }

  function refreshContribBtn() {
    if (!els.btnContrib) return;
    var has = localModelList().length > 0;
    // ⚠️ 需求就是「本地预览成功才能上传」：没有本地模型时按钮必须是**真 disabled**，
    //    光换 title 没用 —— 照样能点开对话框，里面却一个模型都选不了。
    //    上传中（S.contributing）也要禁用，两条取或。
    els.btnContrib.disabled = S.contributing || !has;
    els.btnContrib.title = has
      ? '把这台机器上预览成功的模型上传到仓库（需要你自己的 GitHub 令牌）'
      : '先用「本地预览」成功载入一个模型压缩包，才能贡献';
  }

  function contribStatusText(t) {
    if (!els.contribStatus) return;
    if (!t) { els.contribStatus.hidden = true; return; }
    els.contribStatus.hidden = false;
    els.contribStatusText.textContent = t;
  }

  function contribError(msg) {
    if (!els.contribErr) return;
    if (!msg) { els.contribErr.hidden = true; els.contribErr.textContent = ''; return; }
    els.contribErr.hidden = false;
    els.contribErr.textContent = sanitizeToken(msg);   // 再脱一次敏，防止漏网的
  }

  function currentContribModel() {
    var list = localModelList();
    if (els.contribPick && els.contribPick.value) {
      for (var i = 0; i < list.length; i++) if (list[i].key === els.contribPick.value) return list[i];
    }
    return list[0] || null;
  }

  function syncContribPreview() {
    if (!els.contribPath) return;
    var m = currentContribModel();
    if (!m) {
      els.contribPath.textContent = '—';
      els.contribCount.textContent = '';
      els.contribFiles.innerHTML = '';
      return;
    }
    var files = m._local.files, total = 0;
    files.forEach(function (f) { total += f.bytes.length; });
    // 把仓库名一起显示出来 —— 传之前让用户确认「要传到哪」
    els.contribPath.textContent = contribRepoLabel() + '  →  ' + contribTarget(m) + '/';
    els.contribCount.textContent = '（' + files.length + ' 个 · ' + mb(total) + '）';

    // 清单：目录那一段用淡色，文件名正常色，方便一眼看出结构对不对
    var html = '';
    files.slice(0, 60).forEach(function (f) {
      var i = f.rel.lastIndexOf('/');
      html += i < 0
        ? escapeHtml(f.rel)
        : '<span class="fd">' + escapeHtml(f.rel.slice(0, i + 1)) + '</span>' +
          escapeHtml(f.rel.slice(i + 1));
      html += '<br>';
    });
    if (files.length > 60) {
      html += '<span class="fd">… 以及另外 ' + (files.length - 60) + ' 个文件</span>';
    }
    els.contribFiles.innerHTML = html;
  }

  // 对话框里的「目标仓库」一行：
  //   · 页面自己认出来了（GitHub Pages / ?repo=）→ 显示成只读一行，不让改；
  //   · 认不出来（本地预览 / 自定义域名）→ 显示输入框，预填上次填过的或项目自己的仓库，
  //     但仍要用户看一眼确认 —— 绝不拿建议值当结论静默上传。
  // ⚠️ 这两个标记只活在一次「打开对话框」里，开对话框时重置：
  //   · prefilled —— 建议值只回填一次，否则用户把输入框清空了它又自己填回来，等于清不掉；
  //   · edited    —— 用户有没有真的动过（决定提示是「请确认这个猜测」还是「将上传到这里」）。
  var contribRepoPrefilled = false;
  var contribRepoEdited = false;

  function syncContribRepoUI() {
    if (!els.contribRepo || !els.contribRepoAuto || !els.contribRepoHint) return;
    var r = contribRepoInfo();
    els.contribRepoAuto.hidden = !r.auto;
    els.contribRepo.hidden = !!r.auto;
    if (r.auto) {
      els.contribRepoAuto.textContent = r.owner + '/' + r.repo;
      els.contribRepoHint.innerHTML = (r.source === 'pages')
        ? '已从当前地址（<b>GitHub Pages</b>）自动识别：' + escapeHtml(r.owner + '/' + r.repo) +
          ' —— 就传到这个仓库的 <code>models/' + CONTRIB_DIR + '/</code> 下。'
        : '由地址栏的 <code>?repo=</code> 指定：' + escapeHtml(r.owner + '/' + r.repo) + '。';
      return;
    }
    if (!els.contribRepo.value && !contribRepoPrefilled) {
      var saved = '';
      try { saved = localStorage.getItem(CONTRIB_REPO_KEY) || ''; } catch (e) {}
      if (!saved) {
        var s = suggestedRepoPair();      // 只当建议值回填，用户仍要确认
        if (s) saved = s.owner + '/' + s.repo;
      }
      els.contribRepo.value = saved;
      contribRepoPrefilled = true;
    }
    var pair = manualRepoPair();
    if (!pair) {
      els.contribRepoHint.innerHTML =
        '当前地址<b>推不出仓库</b>（本地预览 / 自定义域名），请自己填 <b>用户名/仓库名</b>。';
    } else if (!contribRepoEdited) {
      els.contribRepoHint.innerHTML =
        '推荐值是项目自带的仓库 <b>' + escapeHtml(pair.owner + '/' + pair.repo) +
        '</b>，<b>请确认</b>是不是要传到它；要传别处就自己改。';
    } else {
      els.contribRepoHint.innerHTML =
        '将上传到 <b>' + escapeHtml(pair.owner + '/' + pair.repo) +
        '</b> 的 <code>models/' + CONTRIB_DIR + '/</code> 下，并同时更新仓库根的 <code>models.json</code>。';
    }
  }

  function loadSavedToken() {
    var saved = '';
    try { saved = localStorage.getItem(CONTRIB_TOKEN_KEY) || ''; } catch (e) {}
    contribTokenMem = saved;
    if (els.contribToken) els.contribToken.value = saved;
    if (els.contribRemember) els.contribRemember.checked = !!saved;
    if (els.btnContribForget) els.btnContribForget.hidden = !saved;
  }

  function forgetSavedToken() {
    contribTokenMem = '';
    try { localStorage.removeItem(CONTRIB_TOKEN_KEY); } catch (e) {}
    if (els.contribToken) els.contribToken.value = '';
    if (els.contribRemember) els.contribRemember.checked = false;
    if (els.btnContribForget) els.btnContribForget.hidden = true;
    toast('已清除这台设备上保存的令牌', { type: 'info' });
  }

  function openContribDialog() {
    if (!els.contribModal) return;
    var list = localModelList();
    if (!list.length) {
      toast('未添加本地预览，先上传本地预览', { type: 'info' });
      return;
    }
    if (S.localOpen) closeLocalDialog();     // 两个对话框不同时开
    // 手机端先把抽屉收掉（见 closeNavForDialog）。放在这行之后：上面那条
    // 「没有本地模型」的早退不该把用户的侧栏顺手收掉。
    closeNavForDialog();

    els.contribPick.innerHTML = '';
    list.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.key;
      o.textContent = m.name + '（' + m.motions + ' 个动作）';
      els.contribPick.appendChild(o);
    });
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (S.model && list[i].key === S.model.key) idx = i;
    els.contribPick.selectedIndex = idx;

    contribError('');
    contribStatusText('');
    contribRepoPrefilled = false;
    contribRepoEdited = false;
    syncContribRepoUI();       // 先定仓库（可能预填输入框），再算目标目录
    syncContribPreview();
    loadSavedToken();
    S.contribOpen = true;
    els.contribModal.hidden = false;
  }

  function closeContribDialog() {
    if (!els.contribModal) return;
    if (S.contributing) return;      // 上传中不让关，免得用户以为取消了其实还在跑
    els.contribModal.hidden = true;
    S.contribOpen = false;
  }

  function setContribBusy(on) {
    S.contributing = !!on;
    if (els.btnContribGo) els.btnContribGo.disabled = !!on;
    if (els.btnContribCancel) els.btnContribCancel.disabled = !!on;
    // ⚠️ 交给 refreshContribBtn：上传结束后还要看「有没有本地模型」决定要不要禁用，
    //    直接写 !!on 会把「无本地模型」那一档又打开。
    refreshContribBtn();
    // ⚠️ 同样只改文字节点
    if (els.btnContribText) els.btnContribText.textContent = on ? '上传中…' : '贡献模型';
  }

  function submitContrib() {
    if (S.contributing) return;
    var m = currentContribModel();
    if (!m) { contribError('没有可上传的模型'); return; }
    var token = (els.contribToken && els.contribToken.value || '').trim();
    if (!token) { contribError('先填 GitHub 令牌'); return; }
    if (!contribRepo()) {
      contribError('先填目标仓库（用户名/仓库名）—— 当前地址认不出要传到哪个仓库');
      if (els.contribRepo && !els.contribRepo.hidden) els.contribRepo.focus();
      return;
    }

    contribTokenMem = token;      // sanitizeToken 要用它做脱敏
    try {
      if (els.contribRemember && els.contribRemember.checked) localStorage.setItem(CONTRIB_TOKEN_KEY, token);
      else localStorage.removeItem(CONTRIB_TOKEN_KEY);
    } catch (e) {}
    if (els.btnContribForget) els.btnContribForget.hidden = !(els.contribRemember && els.contribRemember.checked);

    contribError('');
    contribStatusText('准备中…');
    setContribBusy(true);

    uploadModelToRepo(m, token, contribStatusText).then(function (r) {
      setContribBusy(false);
      contribStatusText('');
      toast('上传完成：' + r.count + ' 个文件已提交到 ' + r.dir, {
        type: 'ok',
        detail: r.branch + ' @ ' + String(r.commit).slice(0, 7) +
                ' · models.json 已一并更新 · 仓库重新构建后（几分钟）刷新页面就能在列表里看到它'
      });
      closeContribDialog();
    }).catch(function (e) {
      setContribBusy(false);
      contribStatusText('');
      var msg = e && e.message ? e.message : String(e);
      if (msg.indexOf('已经有了') >= 0) {
        contribError('');
        toast(msg, { type: 'warn' });
      } else {
        contribError(msg);
      }
    });
  }

  function bindContribDialog() {
    if (!els.contribModal) return;
    if (els.btnContrib) els.btnContrib.addEventListener('click', openContribDialog);
    if (els.btnContribClose) els.btnContribClose.addEventListener('click', closeContribDialog);
    if (els.btnContribCancel) els.btnContribCancel.addEventListener('click', closeContribDialog);
    if (els.contribMask) els.contribMask.addEventListener('click', closeContribDialog);
    if (els.btnContribGo) els.btnContribGo.addEventListener('click', submitContrib);
    if (els.btnContribForget) els.btnContribForget.addEventListener('click', forgetSavedToken);
    if (els.contribPick) els.contribPick.addEventListener('change', syncContribPreview);
    if (els.contribRepo) {
      els.contribRepo.addEventListener('input', function () {
        contribRepoEdited = true;      // 用户动过了 → 提示文案从「请确认」改成「将上传到」
        syncContribRepoUI();
        syncContribPreview();          // 目标目录那一行要跟着仓库名变
      });
      els.contribRepo.addEventListener('change', function () {
        // 记住这次填的，下次打开直接回填（和令牌不同：这不是敏感信息）
        try { localStorage.setItem(CONTRIB_REPO_KEY, els.contribRepo.value.trim()); } catch (e) {}
      });
    }
    if (els.contribRemember) els.contribRemember.addEventListener('change', function () {
      // 取消勾选要立刻把已存的删掉，不能等到下次上传
      if (!els.contribRemember.checked) {
        try { localStorage.removeItem(CONTRIB_TOKEN_KEY); } catch (e) {}
        if (els.btnContribForget) els.btnContribForget.hidden = true;
      }
    });

    // 和本地预览对话框一样：拦掉冒泡，否则会被舞台当成拖动 / 缩放
    els.contribModal.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    els.contribModal.addEventListener('wheel', function (ev) { ev.stopPropagation(); }, { passive: true });
    // 令牌框里敲空格不该去切播放
    els.contribModal.addEventListener('keydown', function (ev) { ev.stopPropagation(); });
  }

  // ---------- 入口：拿到用户选的文件（或拖进来的文件），走完整个流程 ----------
  function handleLocalZip(file) {
    if (!file) return;
    if (S.uploading) { toast('正在处理上一个压缩包，请稍候', { type: 'info' }); return; }

    setLocalError('');   // 上一次的失败原因先擦掉

    if (!/\.zip$/i.test(file.name) &&
        file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
      rejectZip('只支持 .zip 压缩包',
        '收到的是「' + file.name + '」。\n请把模型文件夹压缩成 zip 再上传' +
        '（.rar / .7z 请先转成 zip）。');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      rejectZip('压缩包太大了',
        '当前 ' + mb(file.size) + '，上限 ' + mb(MAX_ZIP_BYTES) + '。\n' +
        '模型通常只有几十 MB，请确认压缩包里没有夹带别的东西。');
      return;
    }

    S.uploading = true;
    setLocalBtnBusy(true);
    localProgress('正在读取压缩包 …', file.name + ' · ' + mb(file.size));

    file.arrayBuffer()
      .then(function (buf) {
        localProgress('正在解压 ' + file.name + ' …', '');
        return readZip(buf);
      })
      .then(function (entries) {
        localProgress('正在校验模型 …', '共 ' + entries.length + ' 个文件');
        return prepareLocalModel(entries, file.name);
      })
      .then(function (entry) {
        S.uploading = false;
        setLocalBtnBusy(false);
        // 先关对话框再上架：加载遮罩的 z-index（5）在对话框（8）下面，
        // 不关的话用户看不到「正在载入模型」的进度
        closeLocalDialog();
        // 不 hideOverlay()：紧接着的 switchModel 会自己接管遮罩，中间不留空档
        addLocalModel(entry);

        var notes = [];
        if (!entry.motions) notes.push('这个模型没有动作数据，只能看静态姿势');
        if (entry._local.dropped.length) {
          notes.push('跳过 ' + entry._local.dropped.length + ' 个缺失文件：' +
                     entry._local.dropped.slice(0, 3).join('、') +
                     (entry._local.dropped.length > 3 ? ' 等' : ''));
        }
        if (entry._local.candidates > 1) {
          notes.push('压缩包里有 ' + entry._local.candidates + ' 个模型，已载入最外层的 ' + entry._local.from);
        }
        toast('已载入本地模型 ' + entry.name, {
          type: notes.length ? 'warn' : 'ok',
          detail: (entry.motions ? entry.motions + ' 个动作 · ' : '') +
                  entry.textures + ' 张贴图 · moc3 ' + entry.mocVersion +
                  (notes.length ? '\n' + notes.join('\n') : '')
        });
      })
      .catch(function (e) {
        S.uploading = false;
        setLocalBtnBusy(false);
        // ⚠️ 校验不通过时**一个字都不改**：模型列表保持原样，当前预览的模型也继续播。
        //    对话框**不关**，原因同时写进对话框和提示条 —— 用户可以立刻换一个文件再试。
        //    只在有模型在播的时候收起遮罩，免得把「一个模型都没有」的初始错误页也盖掉。
        if (S.model) hideOverlay();
        var msg = String((e && e.message) || e);
        setLocalStatus('');
        setLocalError(msg);
        toast('这个压缩包不能用', { type: 'error', detail: msg });
      });
  }

  // ---------- 修 SDK 的一个 URL 解析缺陷：绝对地址（blob:）会被打坏 ----------
  //
  // ⚠️⚠️ 本地导入的模型**必须**走这个补丁，否则 moc3 / 贴图一律加载失败。
  //
  // Cubism4ModelSettings 继承自 ModelSettings，解析文件引用用的是打包进来的
  // Node url 兼容层：
  //     resolveURL(file) { return url.resolve(this.url, file) }
  //
  // 而 Node 的 url.resolve 是「按路径拼接」的旧式解析器：它把 blob: 当普通协议、
  // 把后面的 http://… 当成路径名，序列化时把冒号吃掉：
  //     url.resolve('blob:http://h/u1', 'blob:http://h/u2')
  //       → 'blob:http//h/u2'          ← http 后面的冒号没了
  // SDK 随即拿这个畸形地址去 XHR，控制台里是
  //     [XHRLoader] Failed to load resource as arraybuffer (Status 0): blob:http//…
  // 然后抛 "Texture loading error" / "Network error."，模型载入失败。
  //
  // 远程模型不受影响（http 地址走 url.resolve 本来就是对的），所以只在「已经是
  // 绝对地址」时短路，其余仍旧交给原实现，行为与打补丁前完全一致。
  var ABS_URL_RE = /^(blob:|data:|https?:|file:)/i;

  function patchModelSettingsResolveURL() {
    try {
      var MS = PIXI.live2d.ModelSettings;
      // Cubism4ModelSettings 没有自己实现 resolveURL，是继承来的（实测
      // hasOwnProperty(prototype,'resolveURL') === false），所以改基类一处就够。
      if (!MS || !MS.prototype || typeof MS.prototype.resolveURL !== 'function') return false;
      if (MS.prototype.__l2dAbsUrlPatched) return true;
      var orig = MS.prototype.resolveURL;
      MS.prototype.resolveURL = function (file) {
        if (typeof file === 'string' && ABS_URL_RE.test(file)) return file;
        return orig.call(this, file);
      };
      MS.prototype.__l2dAbsUrlPatched = true;
      return true;
    } catch (e) { return false; }
  }

  // ============ 部件面板（右抽屉）============
  // 把 Yumeiren/tools/live2d-part-inspector 的右侧页面塞进主舞台的右侧：
  //   · 复刻「部件树 + 信息/诊断」两个 tab
  //   · 勾选 = 显示整棵子树 · 滑杆可半透明 · 双击行 = solo · 双击空白 = 恢复
  //   · 导出画面（renderer.extract.canvas）+ 导出配置（hidden.json）
  //   · 清除覆盖（让画面回到模型自己的行为）
  //
  // 关键设计决策（改代码前先读）：
  //   ① 不新建 PIXI 实例 —— 复用 S.l2dModel.internalModel.coreModel._model。
  //   ② 「显示」写的是**显式 1**（不是删掉覆盖），理由和 Yumeiren 一致：
  //      模型自己的 pose3/动作可能把这个部件压 0，删掉覆盖 = 还给模型 = 还是不显示。
  //      想真的交还，用底部「清除覆盖」。
  //   ③ 钩子位置：部件层接在 applyHiddenLayers() 之后（im.update 之前）——
  //      共用一条「csmUpdateModel 之前写 parts.opacities」通道；网格层 hook coreModel.update
  //      的「返回之后」，清 drawables.dynamicFlags bit0（详见 skill 「十」：写在 csmUpdateModel
  //      之前会被重算；写 drawables.opacities 无效）。
  //   ④ 覆盖是临时的 —— 切模型时被 resetPartsPanel 一次性清空。

  function _coreRaw() {
    var im = S.l2dModel && S.l2dModel.internalModel;
    if (!im) return null;
    var cm = im.coreModel;
    if (!cm) return null;
    return cm._model || cm;
  }

  function _has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // 部件「现在应该显示的不透明度」：有覆盖用覆盖值，否则用模型自己给的值（_partsBaseOp）。
  function effOp(i) {
    if (_has(S._partOp, i)) return S._partOp[i];
    return _has(S._partsBaseOp, i) ? S._partsBaseOp[i] : 1;
  }
  function isOverridden(i) { return _has(S._partOp, i); }
  // 模型自己就把它压 0 的（通常是 pose3 / 动作的 PartOpacity 曲线），且我们没覆盖
  function modelHidden(i) {
    return !isOverridden(i) && _has(S._partsBaseOp, i) && S._partsBaseOp[i] < 0.01;
  }
  // 祖先里有任何一个被压成 0，本节点也会跟着消失 —— 用于「灰显祖先藏了的子孙」
  function ancHidden(i) {
    if (!S._parts[i]) return false;
    var c = S._parts[i].parent, guard = 0;
    while (c >= 0 && guard++ < 4096) {
      if (effOp(c) < 0.01) return true;
      var nx = S._parts[c] ? S._parts[c].parent : -1;
      if (nx === c) break;
      c = nx;
    }
    return false;
  }

  function buildParts() {
    var core = _coreRaw();
    if (!core || !core.parts || !core.drawables) { S._parts = []; S._partsOrder = []; return; }
    var pa = core.parts, da = core.drawables;
    var nP = pa.count || pa.ids.length;
    var nD = da.count || da.ids.length;

    var nodes = new Array(nP);
    for (var i = 0; i < nP; i++) nodes[i] = { i: i, name: pa.ids[i], parent: -1, kids: [], depth: 0, nd: 0 };
    for (var j = 0; j < nP; j++) {
      var p = pa.parentIndices[j];
      if (p >= 0 && p < nP && p !== j) { nodes[j].parent = p; nodes[p].kids.push(j); }
    }
    for (var k = 0; k < nP; k++) {
      var d = 0, c = k, guard = 0;
      while (nodes[c].parent >= 0 && guard++ < nP) { c = nodes[c].parent; d++; }
      nodes[k].depth = d;
    }
    S._partsDrawOf = {};
    for (var m = 0; m < nD; m++) {
      var pi = da.parentPartIndices[m];
      if (pi >= 0 && pi < nP) {
        nodes[pi].nd++;
        (S._partsDrawOf[pi] = S._partsDrawOf[pi] || []).push(m);
      }
    }
    S._parts = nodes;
    S._partsOrder = [];
    var roots = [];
    for (var r = 0; r < nP; r++) if (nodes[r].parent < 0) roots.push(r);
    (function walk(list) {
      list.forEach(function (i) {
        S._partsOrder.push(i);
        walk(nodes[i].kids);
      });
    })(roots);
    if (S._partsOrder.length !== nP) {   // 有环的兜底
      var seen = {};
      S._partsOrder.forEach(function (i) { seen[i] = 1; });
      for (var t = 0; t < nP; t++) if (!seen[t]) S._partsOrder.push(t);
    }
  }

  // 捕获「模型自己给的不透明度」基线。⚠️ 必须在换模型之后、用户做任何覆盖之前调一次。
  // 这里临时把覆盖清空，跑一次 cm.update，把 parts.opacities 抄进 _partsBaseOp。
  // （用完再把覆盖恢复回去，避免影响画面。）
  function capturePartsBaseline() {
    var core = _coreRaw();
    if (!core || !core.parts) return;
    var im = S.l2dModel.internalModel, cm = im.coreModel;
    if (!cm) return;
    var backupOp = S._partOp, backupD = S._drawHide;
    S._partOp = {}; S._drawHide = {};
    try { cm.update(); } catch (e) {}
    var pa = core.parts.opacities;
    var nP = core.parts.count || core.parts.ids.length;
    S._partsBaseOp = {};
    for (var i = 0; i < nP; i++) S._partsBaseOp[i] = pa[i];
    S._partOp = backupOp; S._drawHide = backupD;
  }

  // 钩到 coreModel.update：
  //   · 进入时（orig.call 之前）写 parts.opacities —— 在 csmUpdateModel 之前；
  //   · 返回后清 drawables.dynamicFlags 的 bit0 —— 在 resetDynamicFlags() 之后。
  // 见 live2d-web-viewer skill 「十」：写在 update 之前的 opacities 才会真的生效；
  // resetDynamicFlags() 保留 bit0（实测 132 → 132）。
  function installPartsCoreHook() {
    var im = S.l2dModel && S.l2dModel.internalModel;
    if (!im || !im.coreModel) return;
    var cm = im.coreModel;
    if (cm.__l2dPartsHooked) return;
    var orig = cm.update;
    cm.update = function () {
      var core = _coreRaw();
      if (core && core.parts && core.parts.opacities) {
        var po = core.parts.opacities;
        for (var k in S._partOp) {
          if (!_has(S._partOp, k)) continue;
          var i = +k;
          if (i >= 0 && i < po.length) po[i] = S._partOp[k];
        }
      }
      var r = orig.call(cm);
      if (core && core.drawables && core.drawables.dynamicFlags) {
        var df = core.drawables.dynamicFlags;
        for (var k2 in S._drawHide) {
          if (!_has(S._drawHide, k2)) continue;
          var i2 = +k2;
          if (i2 >= 0 && i2 < df.length) df[i2] &= 0xFE;
        }
      }
      return r;
    };
    cm.__l2dPartsHooked = true;
  }

  function resetPartsPanel() {
    S._parts = []; S._partsOrder = []; S._partsCollapsed = {};
    S._partsDrawOf = {}; S._partsBaseOp = {};
    S._partOp = {}; S._drawHide = {};
    S._partSolo = -1; S._partSoloBackup = null;
    S._partsFilter = '';
  }

  function renderParts() {
    var box = els.partsTree;
    if (!box) return;
    if (!S._parts.length) {
      box.innerHTML = '<div class="pempty">还没有加载模型</div>';
      if (els.rightNote) els.rightNote.textContent = '';
      updateFabBadge();
      return;
    }
    var q = (S._partsFilter || '').toLowerCase();
    var html = [];
    var skip = -1;     // 被折叠祖先的深度
    var shown = 0, hidden = 0;

    for (var n = 0; n < S._partsOrder.length; n++) {
      var i = S._partsOrder[n];
      var nd = S._parts[i];
      var hasKids = nd.kids.length > 0 || (S._partsDrawOf[i] || []).length > 0;
      if (!q) {
        if (skip >= 0 && nd.depth > skip) continue;
        skip = -1;
      }
      if (q && nd.name.toLowerCase().indexOf(q) < 0) continue;
      shown++;
      var v = effOp(i);
      var isHidden = v < 0.01;
      if (isHidden) hidden++;
      var anc = ancHidden(i);
      var rowCls = 'prow' + (anc && !isHidden ? ' hidden-anc' : '') + (isOverridden(i) ? ' overridden' : '');
      var pad = 4 + nd.depth * 10;
      html.push('<div class="' + rowCls + '" data-i="' + i + '" style="padding-left:' + pad + 'px">');
      html.push(hasKids
        ? '<span class="tw" data-act="tw" title="折叠/展开">' + (S._partsCollapsed[i] ? '▸' : '▾') + '</span>'
        : '<span class="tw empty">▾</span>');
      html.push('<input type="checkbox" data-act="cb" title="显示/隐藏此部件（连同子树）"' + (isHidden ? '' : ' checked') + '>');
      html.push('<span class="pname" title="' + escapeHtml(nd.name) + '">' +
        highlightName(nd.name, q) +
        (modelHidden(i) ? '<span class="pmodel" title="模型自己把它藏了（pose3 / 动作），不是你干的">模型藏</span>' : '') +
        '</span>');
      html.push('<span class="pnd">' + nd.nd + '</span>');
      html.push('<input type="range" class="pop" data-act="op" min="0" max="100" value="' +
        Math.round(v * 100) + '" title="不透明度">');
      html.push('<button class="psolo" data-act="solo" title="只看这个部件">独</button>');
      html.push('</div>');

      if (!q && !S._partsCollapsed[i]) {
        var core = _coreRaw();
        var dIds = (core && core.drawables && core.drawables.ids) || [];
        (S._partsDrawOf[i] || []).forEach(function (idx) {
          var dname = dIds[idx] || ('网格 ' + idx);
          var dhid = _has(S._drawHide, idx);
          html.push('<div class="prow draw" data-d="' + idx + '" style="padding-left:' + (pad + 18) + 'px">' +
            '<span class="tw empty">▾</span>' +
            '<input type="checkbox" data-act="dcb" title="显示/隐藏这个网格"' + (dhid ? '' : ' checked') + '>' +
            '<span class="pname" title="' + escapeHtml(dname) + '">' + escapeHtml(dname) + '</span>' +
            '<span class="pnd">网格</span></div>');
        });
      }

      if (S._partsCollapsed[i] && hasKids) skip = nd.depth;
    }
    if (!shown) html.push('<div class="pempty">没有匹配的部件</div>');
    box.innerHTML = html.join('');
    if (els.rightNote) {
      els.rightNote.textContent = shown + ' / ' + S._parts.length +
        (hidden ? ' · 隐藏 ' + hidden : '');
    }
    updateFabBadge();
  }

  function highlightName(name, q) {
    if (!q) return escapeHtml(name);
    var low = name.toLowerCase(), at = low.indexOf(q);
    if (at < 0) return escapeHtml(name);
    return escapeHtml(name.slice(0, at)) + '<mark>' + escapeHtml(name.slice(at, at + q.length)) +
      '</mark>' + escapeHtml(name.slice(at + q.length));
  }

  function updateFabBadge() {
    if (!els.btnPartsFab || !els.partsFabDot) return;
    var n = 0;
    for (var k in S._partOp) if (_has(S._partOp, k)) n++;
    for (var k2 in S._drawHide) if (_has(S._drawHide, k2)) n++;
    els.partsFabDot.textContent = n > 99 ? '99+' : String(n);
    els.btnPartsFab.classList.toggle('has-overrides', n > 0);
  }

  // 隐藏 / 显示整棵子树。
  // 「显示」写的是显式 1（理由见函数区上方注释）：模型自己可能把它压 0，
  // 删掉覆盖 = 还给模型 = 部件照样不出现。
  function setSubtree(i, show) {
    var stack = [i];
    while (stack.length) {
      var c = stack.pop();
      S._partOp[c] = show ? 1 : 0;
      var kids = (S._parts[c] && S._parts[c].kids) || [];
      for (var x = 0; x < kids.length; x++) stack.push(kids[x]);
    }
  }

  function toggleSolo(i) {
    if (S._partSolo === i) {
      // 取消 solo。⚠️ 同样要擦 core 里的残留 —— solo 期间把其它部件压成了 0，
      //   光把字典换回 backup 的话，那些「只为 solo 临时设的 0」没人擦，
      //   模型没在播动作时就一直留着（同 clearAllOverrides 的那个坑）。
      //   只擦「solo 期间新加的」：backup 里本来就有的覆盖下一帧会被写回去，不用动。
      var backup = S._partSoloBackup || {};
      var toRestore = {};
      for (var k in S._partOp) {
        if (_has(S._partOp, k) && !_has(backup, k)) toRestore[k] = S._partOp[k];
      }
      restoreOverriddenParts(toRestore, {});
      S._partOp = backup;
      S._partSolo = -1; S._partSoloBackup = null;
      return;
    }
    if (S._partSolo < 0) S._partSoloBackup = Object.assign({}, S._partOp);
    var keep = {};
    var stack = [i];
    while (stack.length) {
      var c = stack.pop();
      keep[c] = 1;
      var kids = (S._parts[c] && S._parts[c].kids) || [];
      for (var x = 0; x < kids.length; x++) stack.push(kids[x]);
    }
    var next = {};
    S._parts.forEach(function (nd) {
      if (!keep[nd.i]) next[nd.i] = 0;
      else if (_has(S._partOp, nd.i)) next[nd.i] = S._partOp[nd.i];
    });
    S._partOp = next;
    S._partSolo = i;
  }

  /* 把 core 里**当前被覆盖**的部件 / 网格擦回「模型自己的状态」。
 *
 * ⚠️⚠️ 光清 JS 侧的字典是不够的 —— core 里已经写进去的值不会自己消失。
 *   覆盖是每帧在 cm.update 之前写进 core.parts.opacities 的；一旦停止写入
 *   （清空字典 / 取消 solo 都是「停止写入」），而模型又正好没在播动作
 *   （参数不动 → SDK 不重算 opacities），上一帧写进去的 0 就一直留在那儿 ——
 *   表现就是「点了清除覆盖 / 取消 solo，画面不恢复」。
 *   所以每次「撤销覆盖」都必须主动把值写回基线。
 *
 * ⚠️ 反过来不能改成「每帧都写基线」：那样会把正在播的动作的
 *   PartOpacity 曲线冻住，模型就不动了。只在撤销的那一刻写一次。
 *
 * 调用时机：撤销覆盖之后、渲染之前。读的是**调用前**的 S._partOp / S._drawHide，
 * 所以必须在清空字典之前调（或者传入旧的字典）。 */
  function restoreOverriddenParts(oldOp, oldDrawHide) {
    var core = _coreRaw();
    if (!core) return;
    if (core.parts && core.parts.opacities) {
      var po = core.parts.opacities;
      for (var k in oldOp) {
        if (!_has(oldOp, k)) continue;
        var i = +k;
        if (i < 0 || i >= po.length) continue;
        // 有基线就用基线（模型自己那一帧的值）；没基线给 1 —— 保守起见让部件重新出现
        var base = (S._partsBaseOp && _has(S._partsBaseOp, i)) ? S._partsBaseOp[i] : 1;
        po[i] = base;
      }
    }
    // 网格同理：bit0（IsVisible）要重新置回「可见」，否则隐藏的网格也不会回来
    if (core.drawables && core.drawables.dynamicFlags) {
      var df = core.drawables.dynamicFlags;
      for (var k2 in oldDrawHide) {
        if (!_has(oldDrawHide, k2)) continue;
        var i2 = +k2;
        if (i2 >= 0 && i2 < df.length) df[i2] |= 1;
      }
    }
  }

  function clearAllOverrides() {
    // 先按「当前覆盖清单」把 core 里的残留值擦回基线，再清字典
    restoreOverriddenParts(S._partOp, S._drawHide);
    S._partOp = {}; S._drawHide = {};
    S._partSolo = -1; S._partSoloBackup = null;
    renderParts();
    if (S._rightTab === 'info') renderInfo();
    toast('已清除本面板的全部覆盖（画面回到模型自己的行为）', { type: 'ok' });
  }

  function exportShot() {
    if (!S.app || !S.l2dModel) { toast('还没有模型可导出', { type: 'error' }); return; }
    try {
      var cv = S.app.renderer.extract.canvas(S.app.stage);
      cv.toBlob(function (b) {
        if (!b) { toast('导出失败：canvas 取不到图', { type: 'error' }); return; }
        var name = (S.model && (S.model.name || S.model.key)) || 'live2d';
        var url = URL.createObjectURL(b);
        var a = document.createElement('a');
        a.href = url; a.download = name + '.png';
        // 同 exportConfig：click 可能抛、也可能把 <a> 自己摘出 DOM，removeChild 要判 parentNode
        document.body.appendChild(a);
        try { a.click(); } catch (e) { console.warn('exportShot click failed:', e); }
        if (a.parentNode) a.parentNode.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        toast('已导出 PNG（含你的显隐覆盖）', { type: 'ok' });
      }, 'image/png');
    } catch (e) { toast('导出失败：' + ((e && e.message) || e), { type: 'error' }); }
  }

  // 构造「隐藏清单」配置对象。
  // exportConfig() 直接下载它；自动化用 __viewer.configObj() 拿到同一份做断言。
  function buildConfigObj() {
    if (!S._parts.length) return null;
    var parts = [];
    var partOps = {};            // 部件名 → 不透明度（字典形式）
    S._parts.forEach(function (nd) {
      // ⚠️ 跳过空名字：有些模型的部件/网格 id 就是 ""（如 Celeste），漏进导出就是脏数据
      if (!nd.name) return;
      if (_has(S._partOp, nd.i) && S._partOp[nd.i] < 0.999) {
        parts.push({ name: nd.name, opacity: S._partOp[nd.i] });
        partOps[nd.name] = S._partOp[nd.i];
      }
    });
    var core = _coreRaw();
    var draw = [];
    if (core && core.drawables && core.drawables.ids) {
      for (var k in S._drawHide) {
        if (!_has(S._drawHide, k)) continue;
        var idx = +k;
        var id = core.drawables.ids[idx];
        // ⚠️ 同上的空 id 过滤："" 进 hiddenDrawables 既脏又无法按名匹配
        if (id) draw.push(id);
      }
    }
    return {
      model: S.model ? (S.model.key || '') : '',
      modelName: S.model ? (S.model.name || '') : '',
      modelPath: S.model ? (S.model.path || '') : '',
      hiddenParts: parts.map(function (p) { return p.name; }),
      partOpacities: parts,
      hiddenPartOps: partOps,   // 字典形式，可还原半透明
      hiddenDrawables: draw,
      _source: 'live2d_v3 部件面板导出',
      _howToApply: '将本导出文件（<模型名>.hidden.json）放入模型文件夹下，与 .moc3 格式文件同级；' +
                   '然后在虞美人.exe 软件的「看板娘中显示与互动」模块里开启「按清单隐藏网格」即可生效。'
    };
  }

  function exportConfig() {
    var obj = buildConfigObj();
    if (!obj) { toast('还没有模型', { type: 'error' }); return; }
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = ((S.model && (S.model.name || S.model.key)) || 'live2d') + '.hidden.json';
    document.body.appendChild(a);
    // ⚠️ 两个坑都在这两行上（无头 Chrome 实测）：
    //   1. a.click() 可能直接抛（下载被拦 / 找不到宿主页面）；
    //   2. click 后浏览器会把这个 <a> 从 DOM 里摘掉，紧接着 removeChild 又是一个
    //      NotFoundError —— 两个异常是连着炸的，只包 click 不够，removeChild 也要判 parentNode。
    //   JSON 其实已经生成好了，下载失败不该让整条调用链断在这里。
    try { a.click(); } catch (e) { console.warn('exportConfig click failed:', e); }
    if (a.parentNode) a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    toast('已导出隐藏清单：' + obj.partOpacities.length + ' 个部件 / ' + obj.hiddenDrawables.length + ' 个网格', { type: 'ok' });
  }

  function renderInfo() {
    var box = els.rightInfo;
    if (!box) return;
    var e = S.model, core = _coreRaw();
    if (!e || !core) { box.innerHTML = '<div class="pempty">还没有加载模型</div>'; return; }
    var im = S.l2dModel.internalModel, cm = im.coreModel;
    var nD = core.drawables.count || core.drawables.ids.length;
    var nP = core.parts.count || core.parts.ids.length;
    var ti = core.drawables.textureIndices;
    var texN = (cm && cm._textures) ? cm._textures.length : ((e.textures || []).length);
    var df = core.drawables.dynamicFlags;
    var vis = 0;
    for (var i = 0; i < nD; i++) if (df[i] & 1) vis++;
    var nModelHidden = 0, nOverridden = 0;
    S._parts.forEach(function (nd) {
      if (modelHidden(nd.i)) nModelHidden++;
      if (isOverridden(nd.i)) nOverridden++;
    });
    var html = [];
    html.push('<div class="sec"><h3>模型</h3><dl class="kv">');
    html.push('<dt>名字</dt><dd>' + escapeHtml(modelTitle(e)) + '</dd>');
    html.push('<dt>路径</dt><dd>' + escapeHtml(e.key || e.path || '') + '</dd>');
    html.push('<dt>moc 版本</dt><dd>' + escapeHtml(e.mocVersion || '?') + '</dd>');
    html.push('<dt>纹理</dt><dd>' + texN + ' 张</dd>');
    html.push('<dt>部件</dt><dd>' + nP + '</dd>');
    html.push('<dt>绘制件</dt><dd>' + nD + '</dd>');
    html.push('<dt>可见网格</dt><dd>' + vis + ' / ' + nD + '</dd>');
    if (nOverridden) html.push('<dt>已被覆盖</dt><dd>' + nOverridden + ' 个部件</dd>');
    if (nModelHidden) html.push('<dt>模型自藏</dt><dd class="warn">' + nModelHidden + ' 个部件（pose3 / 动作压 0）</dd>');
    html.push('</dl></div>');

    // 诊断：纹理越界
    html.push('<div class="sec"><h3>诊断</h3>');
    var bad = [];
    for (var b = 0; b < nD; b++) {
      if (ti[b] < 0 || ti[b] >= texN) bad.push({ name: core.drawables.ids[b], t: ti[b] });
    }
    if (bad.length) {
      var badList = bad.slice(0, 16).map(function (x) {
        return '<code>' + escapeHtml(x.name) + ' → tex[' + x.t + ']</code>';
      }).join(' ');
      var more = bad.length > 16 ? ' …还有 ' + (bad.length - 16) + ' 个' : '';
      html.push('<div class="diag err"><b>' + bad.length + ' 个绘制件引用了越界纹理</b>' +
        '<div class="body">纹理下标 ≥ Textures 张数（' + texN + '），渲染器取不到贴图。' +
        badList + more + '</div></div>');
    } else {
      html.push('<div class="diag ok"><b>没发现问题</b><div class="body">纹理、部件结构都正常。</div></div>');
    }
    html.push('</div>');

    // 纹理清单（缩略图列表，最多 60 张）
    var texList = (e.textures || []);
    if (texList.length) {
      html.push('<div class="sec"><h3>纹理（点一下在新页打开）</h3><div class="texlist">');
      var shown = Math.min(texList.length, 60);
      for (var ti2 = 0; ti2 < shown; ti2++) {
        var t = texList[ti2] || '';
        var url = t ? (S._baseUrl + t) : '';
        html.push('<div class="trow" data-tex="' + escapeHtml(url) + '">' +
          '<span class="tidx">' + ti2 + '</span>' +
          '<span class="tname">' + (t ? escapeHtml(t) : '（空槽位）') + '</span></div>');
      }
      if (texList.length > 60) {
        html.push('<div class="trow" style="cursor:default"><span class="tidx">+</span><span class="tname">' +
          (texList.length - 60) + ' 张未显示</span></div>');
      }
      html.push('</div></div>');
    }
    box.innerHTML = html.join('');
  }

  function setRightPane(open) {
    S.rightPaneOpen = !!open;
    if (appEl) appEl.classList.toggle('right-open', !!open);
    if (open) {
      if (S._rightTab === 'info') renderInfo();
      else renderParts();
    }
    if (els.btnPartsFab) els.btnPartsFab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (typeof scheduleRelayout === 'function') setTimeout(scheduleRelayout, 260);
  }

  function onPartsTreeClick(e) {
    var row = e.target.closest('.prow');
    if (!row) return;
    if (row.dataset.d !== undefined) return;
    var i = +row.dataset.i;
    var act = e.target.dataset && e.target.dataset.act;
    if (act === 'tw') { S._partsCollapsed[i] = !S._partsCollapsed[i]; renderParts(); return; }
    if (act === 'solo') { toggleSolo(i); renderParts(); return; }
    // 行点击本身暂无额外动作（避免与勾选冲突），由 dblclick 处理 solo
  }

  function onPartsTreeChange(e) {
    var t = e.target, act = t.dataset && t.dataset.act;
    if (act === 'cb') {
      var i = +t.closest('.prow').dataset.i;
      setSubtree(i, t.checked);
      renderParts();
    } else if (act === 'dcb') {
      var k = +t.closest('.prow').dataset.d;
      if (t.checked) {
        // ⚠️ 不能只 delete 键：SDK 的 resetDrawableDynamicFlags 不会替我们把
        //    IsVisible（bit0）置回 1，而我们上一轮是「额外」清的它 —— 不补这一位，
        //    网格勾回来也永远不显示（只有重新加载模型才恢复）。见 restoreOverriddenParts。
        var one = {}; one[k] = true;
        restoreOverriddenParts({}, one);
        delete S._drawHide[k];
      } else S._drawHide[k] = true;
      renderParts();
    }
  }

  function onPartsTreeInput(e) {
    var t = e.target;
    if (!t.dataset || t.dataset.act !== 'op') return;
    var i = +t.closest('.prow').dataset.i;
    var v = +t.value / 100;
    S._partOp[i] = v;                 // 显式覆盖（100% 也写 1，理由见 setSubtree）
    var cb = t.closest('.prow').querySelector('input[data-act="cb"]');
    if (cb) cb.checked = v > 0.001;
    updateFabBadge();
  }

  // ---------- 「添加外部模型源」对话框绑定 ----------
  // 与「本地预览」「贡献模型」同一套思路：挂在 .stage 内（不能漏拦 stage 的 pointerdown），
  // 三个入口（点 + / Esc / 点遮罩）汇到同一个开关，进度写在对话框里。
  function bindSrcDialog() {
    if (!els.srcModal) return;

    if (els.btnAddSrc) els.btnAddSrc.addEventListener('click', openSrcDialog);
    if (els.srcClose) els.srcClose.addEventListener('click', closeSrcDialog);
    if (els.srcMask) els.srcMask.addEventListener('click', closeSrcDialog);
    if (els.btnSrcCancel) els.btnSrcCancel.addEventListener('click', closeSrcDialog);

    // ⚠️ 同「本地预览」：弹窗在 .stage 里，pointerdown / wheel 会冒泡给 stage 抢走。
    els.srcModal.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    els.srcModal.addEventListener('wheel', function (ev) { ev.stopPropagation(); }, { passive: true });

    // 输入框变化 → 实时刷新解析预览，并在失焦/回车时把链接记下来
    if (els.srcUrl) {
      els.srcUrl.addEventListener('input', refreshSrcPreview);
      els.srcUrl.addEventListener('change', function () { refreshSrcPreview(); persistSrcUrl(); });
    }
    // 源下拉 + 自定义加速地址 → 刷新预览 + **暂存**这次的选择。
    // ⚠️⚠️ 这里**不能**立刻换源、也不能立刻写 localStorage（rain 2026-09-23 反馈）：
    //    只是把下拉点开看一眼某个加速站，源就被换走了，点「取消」还回不来
    //    —— 因为偏好已经落盘，刷新后照样是它。改成「暂存 → 确认才生效」，
    //    真正 apply 的地方在 submitSrcDialog()（「读取并添加」那条路）。
    if (els.srcKind) {
      els.srcKind.addEventListener('change', function () {
        syncSrcAccelRow();
        refreshSrcPreview();
        // ⚠️ 选到「自定义…」时那一发 change 不该被当成「选了某个源」：此刻小输入框里
        //    装的是上一次留下的脏值（也可能空着），pickedAccelBase() 读到的是它。
        //    自定义地址等用户真敲进小输入框再暂存。
        if (pickedSrcSel() === SRC_SEL_CUSTOM) return;
        stageSrcChange();
      });
    }
    if (els.srcAccelInput) {
      els.srcAccelInput.addEventListener('input', refreshSrcPreview);
      els.srcAccelInput.addEventListener('change', function () {
        refreshSrcPreview();
        stageSrcChange();
      });
    }

    // 「读取并添加」
    if (els.btnSrcGo) {
      els.btnGoHandler = function () {
        var raw = (els.srcUrl && els.srcUrl.value || '').trim();
        if (!raw) { setSrcError('请先粘一个 models.json 链接'); return; }
        var kind = pickedSrcKind();
        var accel = pickedAccelBase();
        if (kind === 'accel' && !accel) {
          setSrcError('选了加速地址但还没填 —— 选一个预设加速站，或在「自定义」里粘一个加速地址');
          return;
        }
        // ⚠️ 走到这里 = 用户点了「读取并添加」，是**确认**动作：
        //    现在才把暂存的源真正生效 + 落盘（见 submitSrcDialog 的注释）。
        //    放在校验之后 —— 校验没过就别改源，用户还要接着改。
        stageSrcChange();
        if (commitSrcChange()) renderModels();
        setSrcError('');
        setSrcStatus('解析中…', '');
        var info;
        try {
          info = parseExternalUrl(raw);
          // 下拉强制选源 —— 用 owner/repo/branch 重新拼 base
          var rawBase = 'https://raw.githubusercontent.com/' + info.owner + '/' + info.repo + '/' + info.branch + '/';
          if (kind === 'github') {
            info = { owner: info.owner, repo: info.repo, branch: info.branch,
                     source: 'github', accel: '', base: rawBase, url: raw };
          } else {
            info = { owner: info.owner, repo: info.repo, branch: info.branch,
                     source: 'accel', accel: accel,
                     base: accelerate(rawBase, accel), url: raw };
          }
        } catch (e) {
          setSrcError('解析失败\n' + (e && e.message ? e.message : String(e)));
          setSrcStatus('');
          return;
        }
        els.btnSrcGo.disabled = true;
        addExternalSource(info, function (err) {
          els.btnSrcGo.disabled = false;
          if (err) { setSrcError('拉取失败：' + (err.message || err)); return; }
          // 成功了才记 —— 打错的链接不值得下次再预填
          persistSrcUrl();
        });
      };
      els.btnSrcGo.addEventListener('click', els.btnGoHandler);
    }
  }

  function bindPartsPanel() {
    if (els.btnPartsFab) els.btnPartsFab.addEventListener('click', function () { setRightPane(!S.rightPaneOpen); });
    if (els.btnRightClose) els.btnRightClose.addEventListener('click', function () { setRightPane(false); });

    // ⚠️⚠️ 关键：FAB 和抽屉都在 .stage 里，而舞台的 pointerdown 会
    //   stage.setPointerCapture(e.pointerId) —— 一旦 pointer 被舞台捕获，
    //   后续的 pointerup / **click** 全被路由到 stage，FAB 的 click listener 永远收不到
    //   （现象就是「点了按钮没反应」，但直接 .click() 又能开）。
    //   所以 pointerdown 必须在冒泡到 stage 之前拦掉 —— 跟提示条 / 两个对话框同样的处理。
    //   抽屉本体同理：不拦的话在抽屉里拖动会变成「拖模型」、滚轮会变成「缩放模型」。
    [els.btnPartsFab, els.rightPane].forEach(function (el) {
      if (!el) return;
      el.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      el.addEventListener('wheel', function (ev) { ev.stopPropagation(); }, { passive: true });
    });

    // tab 切换
    Array.prototype.forEach.call(document.querySelectorAll('.right-tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.right-tab'), function (x) { x.classList.remove('on'); });
        t.classList.add('on');
        S._rightTab = t.dataset.rtab;
        if (els.tabParts) els.tabParts.hidden = t.dataset.rtab !== 'parts';
        if (els.tabInfo) els.tabInfo.hidden = t.dataset.rtab !== 'info';
        if (t.dataset.rtab === 'info') renderInfo();
        else renderParts();
      });
    });

    // 搜索 / 展开 / 折叠
    if (els.partsSearch) els.partsSearch.addEventListener('input', function (e) {
      S._partsFilter = e.target.value;
      renderParts();
    });
    if (els.partsExpand) els.partsExpand.addEventListener('click', function () {
      S._partsCollapsed = {};
      renderParts();
    });
    if (els.partsCollapse) els.partsCollapse.addEventListener('click', function () {
      S._parts.forEach(function (nd) { S._partsCollapsed[nd.i] = true; });
      renderParts();
    });

    // 树的事件委托
    if (els.partsTree) {
      els.partsTree.addEventListener('click', onPartsTreeClick);
      els.partsTree.addEventListener('change', onPartsTreeChange);
      els.partsTree.addEventListener('input', onPartsTreeInput);
      els.partsTree.addEventListener('dblclick', function (e) {
        var row = e.target.closest('.prow[data-i]');
        if (row) { toggleSolo(+row.dataset.i); renderParts(); }
        else if (S._partSolo >= 0) { toggleSolo(S._partSolo); renderParts(); }
      });
    }

    // 工具栏
    if (els.btnClearOverrides) els.btnClearOverrides.addEventListener('click', clearAllOverrides);
    if (els.btnExportShot) els.btnExportShot.addEventListener('click', exportShot);
    if (els.btnExportConfig) els.btnExportConfig.addEventListener('click', exportConfig);

    // 信息 tab 的纹理点击（新页打开）
    if (els.rightInfo) els.rightInfo.addEventListener('click', function (e) {
      var row = e.target.closest('.trow');
      if (row && row.dataset.tex) window.open(row.dataset.tex, '_blank');
    });

    updateFabBadge();
  }

  // ---------- 关闭 SDK 的自动 Idle 动作 ----------  //
  // ⚠️⚠️ 这是「动作播到一半被顶掉 / 自动连播卡住」的根因，动这块代码前务必读完。
  //
  // assets/cubism4.min.js 里 MotionManager.update() 长这样：
  //
  //   update(t, e) {
  //     return this.isFinished() && (
  //         this.playing && (this.playing = false, this.emit("motionFinish")),
  //         this.state.shouldOverrideExpression() && this.expressionManager?.restoreExpression(),
  //         this.state.complete(),
  //         this.state.shouldRequestIdleMotion() && this.startRandomMotion(this.groups.idle, IDLE)
  //       ), this.updateParameters(t, e)
  //   }
  //
  // 而 `shouldRequestIdleMotion() { return currentGroup === undefined && reservedIdleGroup === undefined }`
  // —— 只要**动作队列空了**，SDK 就会自己从 Idle 组随机起一个动作。
  //
  // 后果（实测）：我们让动作按真实时长播完、正要切下一个时，SDK 已经抢先塞进一个
  // **我们从未配置过**的队列项。它的 startTime 由 SDK 在首次求值时写成「当时的 elapsed」，
  // 于是 currentTime() = elapsed - startTime 恒等于 0，页面以为动作才刚开始 ——
  // 「播完自动下一个」永远不触发，画面就在 Idle 上无限重播。
  // zhala_2 表现最典型：login(22.33s) 播完后，每 12 秒（Idle 的时长）自己重启一次。
  //
  // 关掉的开关是 idleMotionGroup（在 Live2DModel.from 的选项里），但**不能传空串**：
  // SDK 写的是 `(t?.idleMotionGroup) && (this.groups.idle = t.idleMotionGroup)`，
  // 空串是 falsy，等于没传 —— 之前就是这么写的，所以一直没生效。
  // 传一个不可能存在的组名即可：startRandomMotion 里 `const i = this.definitions[组名]`
  // 取不到就直接 return false，不会抛异常。
  var NO_IDLE_GROUP = '__no_auto_idle__';

  function disableAutoIdle(mm) {
    if (!mm) return;
    try { mm.stopAllMotions(); } catch (e) {}
    try {
      // 双保险：万一 idleMotionGroup 那条路没走到（例如 SDK 版本变了、init 参数换了），
      // 这里直接把「随机起动作」这个入口封掉。页面自己按顺序播，不需要 SDK 插手。
      mm.groups && (mm.groups.idle = NO_IDLE_GROUP);
      mm.startRandomMotion = function () { return Promise.resolve(false); };
    } catch (e) {}
  }

  // ---------- 4. 舞台与缩放 ----------
  function stageSize() {
    var r = els.stage.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  // 许多模型的 moc 画布是 3000x3000 之类的正方形，但角色实际只占其中一小块。
  // 直接用画布尺寸做自适应会把角色缩得非常小，因此按 drawable 顶点求真实包围盒。
  // 坐标换算与 SDK 的 getDrawableVertices 保持一致：
  //   px = vx * pixelsPerUnit + originalWidth  / 2
  //   py = -vy * pixelsPerUnit + originalHeight / 2
  function contentBounds(model) {
    var im = model.internalModel;
    var ow = (im && im.originalWidth) || model.width || 1;
    var oh = (im && im.originalHeight) || model.height || 1;
    var full = { x: 0, y: 0, w: ow, h: oh };

    var core = im && im.coreModel;
    var dd = core && core.drawables;
    if (!dd || !dd.vertexPositions || !dd.vertexCounts) return full;

    var ppu = im.pixelsPerUnit || 1;
    var vp = dd.vertexPositions, vc = dd.vertexCounts;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var off = 0, any = false;
    for (var i = 0; i < vc.length; i++) {
      var n = vc[i] | 0;
      for (var j = 0; j < n; j++) {
        var vx = vp[off + j * 2];
        var vy = vp[off + j * 2 + 1];
        if (!isFinite(vx) || !isFinite(vy)) continue;
        var px = vx * ppu + ow / 2;
        var py = -vy * ppu + oh / 2;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        any = true;
      }
      off += n * 2;
    }
    if (!any || !isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return full;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function fitScale(model) {
    if (!model) return 1;
    var box = stageSize();
    var b = contentBounds(model);
    if (!b.w || !b.h || !isFinite(b.w) || !isFinite(b.h)) return 1;
    // 留出边距，保证角色完整可见
    return Math.min((box.w * 0.88) / b.w, (box.h * 0.96) / b.h);
  }

  function layoutModel(refit) {
    if (!S.l2dModel || !S.app) return;
    var box = stageSize();
    S.app.renderer.resize(box.w, box.h);
    if (refit) { S.view.scale = fitScale(S.l2dModel); S.view.x = 0; S.view.y = 0; }
    applyView();
    // 同上：resize 会清空绘制缓冲，同步补一次渲染，别让「复位视图 / 换模型」闪一下
    if (S.l2dModel) { try { S.app.render(); } catch (e) {} }
  }

  function applyView() {
    if (!S.l2dModel) return;
    var box = stageSize();
    var b = contentBounds(S.l2dModel);
    // 模型以锚点 (0.5,0.5) 定位，锚点落在画布中心 (ow/2, oh/2)。
    // 要让“内容包围盒中心”对上舞台中心，需额外偏移二者的差值。
    var ow = (S.l2dModel.internalModel && S.l2dModel.internalModel.originalWidth) || S.l2dModel.width || 1;
    var oh = (S.l2dModel.internalModel && S.l2dModel.internalModel.originalHeight) || S.l2dModel.height || 1;
    var dx = (b.x + b.w / 2) - ow / 2;
    var dy = (b.y + b.h / 2) - oh / 2;
    S.l2dModel.scale.set(S.view.scale);
    S.l2dModel.x = box.w / 2 + S.view.x - dx * S.view.scale;
    S.l2dModel.y = box.h / 2 + S.view.y - dy * S.view.scale;
  }

  // 从当前 view.scale 反推出「百分比」（100 = 满适配）。
  // 滚轮缩放、双指捏合都用这个拿到当前比例再继续累乘；之前是直接读 els.zoom.value。
  function currentZoomPercent() {
    if (!S.l2dModel) return 100;
    var base = fitScale(S.l2dModel);
    if (!base) return 100;
    return S.view.scale / base * 100;
  }

  function setZoomPercent(p) {
    if (!S.l2dModel) return;
    var base = fitScale(S.l2dModel);
    S.view.scale = base * (p / 100);
    applyView();
  }

  function resetView() {
    S.view.x = 0; S.view.y = 0;
    S.speed = 1;
    els.speed.value = '100';
    els.speedVal.textContent = '1.0×';
    layoutModel(true);
  }

  // ---------- 5. 动作播放 ----------
  // 关键 API（实测 pixi-live2d-display 0.4 + Cubism 4/5 Core）：
  //   internalModel.motionManager                  动作管理器
  //   .motionGroups[groupName]                     已解析的动作对象数组（顺序与 definitions 一致）
  //   .queueManager._motions[]                     正在播放的队列项
  //   queueEntry._motion.getDuration()             动作时长（秒）
  //
  // 【重要】这个构建里 queueManager._userTimeSeconds 是死字段：
  //   Cubism4MotionManager 只有 updateParameters(coreModel, userTimeSeconds)，
  //   而它上层的 Cubism4InternalModel.update() 传进来的是「每帧秒数」(≈0.0167)，
  //   不是累计时钟。同时 queueManager.startMotion(motion, false, t) 的第三个参数被忽略，
  //   队列项的 startTime 恒为 0。
  //   结果：若依赖它，动作永远停在第一帧。
  //   因此时间轴由我们自己的 S.motionClock 维护，并换算成 doUpdateMotion 需要的「当前时间」。
  //
  //   播放路径：mm.queueManager.doUpdateMotion(coreModel, 当前时间秒)
  //   暂停/拖动的办法：直接操作队列项的 startTime（doUpdateMotion 用 当前时间 - startTime 求进度）
  function motionManager() {
    return S.l2dModel && S.l2dModel.internalModel && S.l2dModel.internalModel.motionManager;
  }

  function coreModel() {
    return S.l2dModel && S.l2dModel.internalModel && S.l2dModel.internalModel.coreModel;
  }

  // 在 motionManager 里找到 S.motions[i] 对应的那个「已加载的动作对象」。
  //
  // 两条路：
  //   1. 按下标直接取：mm.motionGroups[group][localIndex]
  //      SDK 的 setupMotions 是 `for(let t=0;t<this.definitions[group].length;t++) this.loadMotion(group,t)`，
  //      所以 motionGroups[group] 的下标与 definitions[group] 一一对应；
  //      而 definitions 就是 model3.json 的 FileReferences.Motions，键序与文件里一致。
  //      parseMotions 也按同样的键序编号 localIndex，因此下标是对得上的。
  //   2. 按下标取不到（或取到的对象文件名不符）时，用 definitions 里的 File 反查。
  //      ⚠️ 不能用 mm.getMotionFile(motionGroups[g][i])：那个函数读的是 *定义* 的 .File，
  //      而 motionGroups 里放的是已加载的 *动作对象*（没有 .File 字段），返回 undefined。
  //      要拿文件名得走 mm.definitions[group][i].File。
  function findMotionObject(mm, mo) {
    if (!mm || !mo) return null;
    var group = mo.group || '';
    var groups = mm.motionGroups || {};
    var defs = (mm.definitions && mm.definitions[group]) || null;
    var list = groups[group] || null;

    // 1. 下标直取，并核对文件名（防止个别模型 definitions 顺序被 SDK 重排）
    if (list && typeof mo.localIndex === 'number' && mo.localIndex >= 0) {
      var cand = list[mo.localIndex];
      if (cand) {
        var defFile = defs && defs[mo.localIndex] ? defs[mo.localIndex].File : null;
        if (!defFile || sameMotionFile(defFile, mo.file)) return cand;
      }
    }

    // 2. 按 File 名在 definitions 里反查，再取同下标的动作对象
    if (defs && list) {
      for (var i = 0; i < defs.length; i++) {
        if (sameMotionFile(defs[i] && defs[i].File, mo.file) && list[i]) return list[i];
      }
    }
    return null;
  }

  // 比较动作文件名。model3.json 里可能是 'motions/x.motion3.json'，
  // apply 过 URL 处理后可能变成绝对路径，统一按文件名比对。
  function sameMotionFile(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return String(a).split('/').pop() === String(b).split('/').pop();
  }

  // 取出当前正在播放的队列项
  function activeEntry() {
    var mm = motionManager();
    if (!mm || !mm.queueManager) return null;
    var list = mm.queueManager._motions || [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i]._motion) return list[i];
    }
    return null;
  }

  // 当前动作已经播放的秒数
  function currentTime() {
    var e = activeEntry();
    if (!e) return 0;
    var mm = motionManager();
    // doUpdateMotion 里用的是「当前时间 - startTime」，两者都在 doUpdateMotion 的时间基上
    var t = mm.queueManager._doUpdateTime - e.getStartTime();
    if (!isFinite(t) || t < 0) t = 0;
    return t;
  }

  function currentDuration() {
    var e = activeEntry();
    if (e && e._motion && typeof e._motion.getDuration === 'function') {
      var d = e._motion.getDuration();
      if (isFinite(d) && d > 0) return d;
    }
    return (S.motions[S.current] || {}).duration || 0;
  }

  // 当前动作是否标了 Meta.Loop。
  //
  // ⚠️ 不要用 e._motion.isLoop() 当唯一判据：实测 Cubism4MotionManager 载入后
  //    动作对象的 _isLoop 恒为 false（即使 motion3.json 里写了 Meta.Loop = true），
  //    因为 _isLoop 是「解析时」才写进去的，而 SDK 在 preload/loadMotion 的快路径下
  //    并不会把 Meta.Loop 带过来。
  //    真相来源是我们自己 scan 出来的 S.motions[i].loop（直接读 motion3.json 的 Meta.Loop）。
  //    所以优先用本地标记，只有在它没给出结论时才回落到 SDK 的值。
  //
  // 注意：这个函数现在的唯一用途是「别给循环动作挂定格项」（见 tickProgress）。
  //      自动推进**不再**区分是否循环 —— 不管 Meta.Loop 是什么，都完整播一遍真实时长。
  function isCurrentLoop() {
    var mo = S.motions[S.current];
    if (mo && mo.loop) return true;          // 本地标记是权威（来自 Meta.Loop）
    var e = activeEntry();
    if (e && e._motion && typeof e._motion.isLoop === 'function') {
      try { return !!e._motion.isLoop(); } catch (err) {}
    }
    return false;
  }

  // ---------- 动作没启动起来时的自动恢复 ----------
  // 有两种情况会让队列变空、画面卡死（时间轴永远是 0）：
  //   · 刚切完模型，动作对象还在后台异步加载（motionPreload:'ALL' 不是同步的），
  //     这一刻 findMotionObject 拿不到东西；
  //   · 切换的那一瞬间 playMotion 作用在了上一支模型遗留的队列上
  //     （两组模型的组名和动作文件名一样时尤其容易发生，比如都是 '' 组 + motions/complete.motion3.json），
  //     新模型的队列因此是空的。
  // 两种情况的共同点都是「队列里既没有正在播的动作、也没有定格项」。
  // 所以只要发现这个状态就重新启动当前动作：每 300ms 一次、不设次数上限 ——
  // 动作一变得可用就自动接上，永远不会出现「切完模型什么都不播」。
  var START_RETRY_MS = 300;
  var lastStartAt = 0;

  function tickStartRecovery() {
    if (!S.playing) return;                       // 暂停时不打扰
    // 正在换模型：这会儿 S.motions / S.l2dModel 都可能还是上一支模型的，
    // 照常重启会把旧动作重新入队（还会把 S.primed 置回 true，干扰新模型的装载）。
    // 新模型的启动由 switchModel 末尾的 playMotion(0) 负责。
    if (S.busyModel) return;
    if (activeEntry() || S.pausedEntry) return;    // 队列里有东西就说明是正常状态
    if (Date.now() - lastStartAt < START_RETRY_MS) return;
    lastStartAt = Date.now();
    playMotion(S.current < 0 ? 0 : S.current, true);
  }

  function playMotion(index, silent) {
    if (!S.motions.length) return;
    index = (index + S.motions.length) % S.motions.length;
    S.current = index;
    S.motionClock = 0;
    S.holdTime = 0;
    S.finished = false;
    S._skipCount = 0;      // 真的有一个动作开始播了 → 把「连续跳过空模型」的计数清零
    clearHoldEntry();
    var mo = S.motions[index];

    var mm = motionManager();
    if (mm) {
      try { mm.stopAllMotions(); } catch (e) {}
      var motionObj = findMotionObject(mm, mo);
      if (motionObj) {
        // 硬切：清零淡入时间，确保无过渡混合
        motionObj._fadeInSeconds = 0;
        mm.queueManager.startMotion(motionObj, false);
        var qe = activeEntry();
        if (qe) {
          var durS = motionObjectDuration(motionObj, mo);
          qe.setIsStarted(true);
          qe.setStartTime(0);
          qe.setEndTime(durS > 0 ? durS : HOLD_END);
          qe.setFadeInStartTime(-0.001);
        }
        mm.queueManager._doUpdateTime = 0;
        mm.playing = true;
      }
      // 拿不到动作对象时**什么都不做**，交给 tickStartRecovery 每 300ms 重试。
      //
      // ⚠️ 这里曾经写了一个 `S.l2dModel.motion(mo.group || '', 0)` 的兜底，必须保持删除：
      //   它走的是 SDK 的 MotionManager.startMotion(group, index) —— 那条路会把
      //   `state.reserve(group, index, priority)` 占上，并且**异步**插入一个
      //   我们完全没配置过的队列项（startTime/endTime 都由 SDK 自己写）。
      //   后果有两层：
      //     · 那个队列项的 startTime 是「当时的 elapsed」，我们算出来的动作进度会错位；
      //     · 更要命的是 reserve 被占住之后，下一次 playMotion 再调它会被判
      //       「Motion is already reserved.」直接返回 false —— 于是队列一直空着，
      //       页面停在「playing=true 但什么都没播」的状态，最后被定格分支误判成播完，
      //       连恢复逻辑都因为 playing=false 而失效（实测 biaoqiang 就是这么卡住的）。
    }

    lastStartAt = Date.now();
    S.playing = true;
    S.primed = true;
    playMotionSound(mo);
    setPlayIcon();
    renderMotionBadge();
    if (!silent) saveState();
  }

  function setPlayIcon() {
    els.icoPlay.style.display = S.playing ? 'none' : '';
    els.icoPause.style.display = S.playing ? '' : 'none';
    els.btnPlay.title = S.playing ? '暂停' : '播放';
  }

  function togglePlay() {
    if (!S.l2dModel) return;
    var mm = motionManager();
    S.playing = !S.playing;
    if (mm) { try { mm.playing = S.playing; } catch (e) {} }

    if (S.playing) {
      // 从定格恢复。已经走到末尾（自然播完）就重播；
      // 中途定格则要「从定格位置续播」，不能简单重播，否则画面会跳回开头。
      if (S.pausedEntry) {
        var hd = currentDuration();
        var atEnd = S.finished || (hd > 0 && S.holdTime >= hd - 0.05);
        var resumeAt = S.holdTime;
        clearHoldEntry();
        S.finished = false;
        if (atEnd) {
          playMotion(S.current, true);
        } else {
          resumeMotionAt(resumeAt);
        }
        return setPlayIcon();
      }
      clearHoldEntry();
      S.finished = false;
    } else {
      // 暂停：把当前进度就地钉死，防止 SDK 自己继续往前走
      stopCurrentAudio();
      if (!S.pausedEntry && S.holdTime >= 0) {
        var im = S.l2dModel.internalModel, cmp = coreModel();
        if (im && mm && mm.queueManager && cmp) {
          S.holdTime = S.motionClock;
          S.finished = false;   // 中途暂停不是「播完」，按播放应当续播
          mountHoldEntry(mm, cmp, S.holdTime);
        }
      }
    }
    setPlayIcon();
  }

  // 每个渲染帧推进动作时间轴，并把参数写进模型。
  // 该构建的 internalModel.update() 只按「帧间隔」驱动动作，不会累加时间，
  // 所以我们接管动作时间轴：自己累加 S.motionClock，再用 doUpdateMotion 算出这一帧的参数。
  // 但 internalModel.update() 同时还负责呼吸、眨眼、物理、以及最关键的
  // coreModel.update()/loadParameters()（把参数真正写进 drawable），
  // 所以仍需调用它，只是传真实的帧间隔 + 动作时间轴位置。
  function tickProgress(delta) {
    if (!S.l2dModel) return;
    // 无动作模型（model3.json 没有 Motions，如 Celeste 这类纯表情 / 静态立绘）：
    // 下面「按动作时间轴推进」的全套逻辑都派不上用场，而且要避开「列表循环」卡死在它
    // 身上（交给 tickSkipMotionless 处理轮播）。
    // ⚠️ 但**不能**只 return —— 否则部件覆盖 / 网格隐藏（写在 cm.update 钩子里）
    // 永远写不进 core，右抽屉里的勾选 / 滑杆 / solo / 网格隐藏「改了看不到反应」。
    // 所以每帧先轻量跑一次 im.update：呼吸/眨眼/物理照常 + cm.update 触发覆盖钩子，
    // 让调节实时生效；再交给 tickSkipMotionless 处理「列表循环」轮播。
    if (!S.motions.length) {
      try {
        var im0 = S.l2dModel.internalModel;
        if (im0) {
          applyHiddenLayers();
          im0.update((1 / 60) * 1000, 0);
        }
      } catch (e0) {}
      tickSkipMotionless();
      return;
    }
    // 换模型时，新模型挂上舞台到 playMotion() 跑起来之间会隔几帧。
    // 这几帧里如果照常走下面的逻辑，就会用一个「上一个模型留下的」S.motionClock
    // 去初始化新动作队列项 —— SDK 会在首次求值时把
    //   startTime = fadeInStartTime = 当时的 t
    // 于是 fadeIn 权重恒为 ease(0)=0，动作参数一个都写不进去，画面只剩呼吸/物理。
    // 下面这个「出错就静默重试」的循环必须等 playMotion 把时钟和队列都重置好。
    if (!S.primed) {
      // 还没准备好：只把 SDK 的呼吸/物理跑起来，别碰动作时间轴
      try { S.l2dModel.internalModel.update((1 / 60) * 1000, 0); } catch (e0) {}
      return;
    }
    var im = S.l2dModel.internalModel;
    var mm = motionManager();
    var cm = coreModel();
    if (!im || !mm || !mm.queueManager || !cm) return;

    var dur = currentDuration();
    // 时长读不到的动作用兜底值，否则「播完自动下一个」永远不触发，会卡死在这一个动作上
    if (!(dur > 0)) dur = FALLBACK_DUR;

    // 帧间隔（秒）。
    //
    // ⚠️ PIXI 的 ticker 回调给的是 deltaTime —— **已经按 60fps 归一化过的帧数**：
    //      this.deltaMS   = 真实帧间隔（毫秒）
    //      this.deltaTime = this.deltaMS * TARGET_FPMS   (TARGET_FPMS = 0.06 = 1/16.667)
    //      n.emit(this.deltaTime)
    //    所以换算成秒是 delta / 60，**不能**除以 ticker.FPS。
    //    ticker.FPS 是「实测帧率」（1000 / elapsedMS），高刷屏上会是 144 / 165 / 240：
    //    拿它当除数会让动作按 (60 / 实测帧率) 倍慢放 —— 屏幕越流畅、动作越慢。
    //    这个 bug 在 60Hz 屏上完全看不出来，只在 144Hz 以上的机器上暴露。
    var dt;
    if (typeof delta === 'number') {
      dt = delta / 60;
    } else {
      dt = (S.app && S.app.ticker && S.app.ticker.deltaMS ? S.app.ticker.deltaMS / 1000 : 1 / 60);
    }
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25;   // 从后台切回来时别一下跳太多

    var e = activeEntry();

    // 定格项已在队列里时，activeEntry() 也会返回它；这里先辨认清楚，
    // 让下面的分支走「定格」路径而不是「正常推进」路径。
    var holding = !!S.pausedEntry && e === S.pausedEntry;

    // ⚠️⚠️ 「这个动作已经播完了吗」必须在这里、也就是 tickStartRecovery() **之前**判定。
    //
    //   队列项被 SDK 摘掉的那一帧，如果先跑 tickStartRecovery，它会用同一个下标调
    //   playMotion()，把动作重新入队并**把 S.motionClock 清零** —— 紧接着下面
    //   「播完自动下一个」的判据 `holdTime >= dur` 就永远不成立了，动作无限重播、
    //   再也切不走（换模型自然也一起失效）。
    //
    //   这个竞态一直存在，只是 1× 速度下 t 逼近 dur 的帧很多，通常是自动推进先赢，
    //   所以看不出来；**3× 速度或低帧率下必现**（实测 3× 时每 4 秒原地重播一次，
    //   而 1× 时能正常切走）。判据用上一帧的 holdTime 就够了：holdTime 是被
    //   min(motionClock, dur) 夹住的，一旦到过 dur 就一直是 dur。
    var ended = !holding && dur > 0 && S.holdTime >= dur - 0.02;

    // 队列空、也没有定格项、而且**不是刚播完** = 什么都没在播（动作压根没启动起来）
    // → 重新启动当前动作。见 tickStartRecovery 的说明：这是「切完模型不播」的兜底。
    if (!holding && !e && !S.pausedEntry && !ended) tickStartRecovery();

    // 时间轴推进：暂停 / 定格时停表。
    //
    // ⚠️ 这里有两件事必须同时成立，否则会出现「卡死」或「莫名跳过某个动作」：
    //
    //   1) 动作在末尾被 SDK 摘出队列之后，时钟还得继续走到 holdTime >= dur，
    //      否则「播完自动下一个」的判据永远不成立。所以这里**不要求 e 非空**。
    //   2) 但如果队列空着、而且时钟离末尾还远，那说明动作**压根没启动起来**
    //      （动作对象还在异步加载 / SDK 的 state.reserve 被上一支动作占着）。
    //      这时绝不能推进时钟 —— 否则 holdTime 会一路涨到 dur，被误判成「播完了」
    //      而直接跳到下一个动作。这种状态留给 tickStartRecovery 去重启当前动作。
    var stalled = !e && dur > 0 && S.holdTime < dur - 0.05;
    if (!holding && S.playing && !stalled) {
      S.motionClock += dt * S.speed;
      S.holdTime = Math.min(S.motionClock, dur > 0 ? dur : S.motionClock);
    }

    if (holding) {
      // 暂停 / 播完定格：起止时间已在入队时定死，
      // 每帧按同一时刻重放一次即可，参数恒定不变 → 画面稳定不抖。
      S.motionClock = S.holdTime;
      var qh = mm.queueManager;
      qh._doUpdateTime = S.holdTime;
      try { qh.doUpdateMotion(cm, S.holdTime); } catch (err) {}
    } else if (e) {
      // 用我们自己的时间重算这一帧的动作参数
      var qt = mm.queueManager;
      qt._doUpdateTime = S.motionClock;
      try { qt.doUpdateMotion(cm, S.motionClock); } catch (err) {}
    } else if (S.holdTime > 0 && !isCurrentLoop() && dur > 0 && S.holdTime >= dur - 0.05) {
      // 非循环动作播完后 SDK 会把队列项移除，此时把最后一帧续上，
      // 避免参数回到初始姿势。
      // 注意：这里必须「只入队一次」，否则每帧重新 startMotion 会让动作
      // 在起始姿势与末帧之间反复横跳，表现为人物持续快速抖动。
      //
      // 走到这个分支说明「原本在播、现在队列空了」= 动作自然播完。
      // ⚠️ 必须同时满足 holdTime >= dur - 0.05（真的走到末尾了）。
      //    少了这个条件，「动作没启动起来」也会被当成「播完了」：
      //    那时 mountHoldEntry 因为拿不到动作对象而直接 return，
      //    于是 S.playing 被置成 false、队列又是空的 —— 页面彻底停住，
      //    连 tickStartRecovery 都被 `if (!S.playing) return` 挡住，再也救不回来。
      S.finished = true;
      S.motionClock = S.holdTime;
      mountHoldEntry(mm, cm, S.holdTime);
      // 只有定格项真的挂上了才停表；挂不上就保持 playing=true，交给 tickStartRecovery
      if (S.pausedEntry) { S.playing = false; setPlayIcon(); }
    }
    // 标了 Meta.Loop 的动作（zhala_2 是全部动作都标了）在这里不挂定格项 ——
    // 挂了就会变成 holding，反过来挡住下面「播完自动下一个」的推进。
    // 它们和普通动作一样：时钟走到 dur 就切下一个。

    // 交给 SDK 完成动作求值、呼吸/眨眼/物理/姿势，并最终把参数提交到 drawable。
    //
    // 两个参数的含义（从 minified 源码逆出）：
    //   update(deltaMS, elapsedMS) {
    //     t = deltaMS/1000; e = elapsedMS/1000;
    //     n = motionManager.update(cm, e)        // ← 动作按 elapsed 求值！
    //     cm.saveParameters()
    //     expressionManager?.update(cm, e)       // ← 表情也按 elapsed
    //     n || eyeBlink?.updateParameters(cm, t) // ← 眨眼按 delta
    //     updateFocus()
    //     updateNaturalMovements(1e3*t, 1e3*e)   // → breath 用 t
    //     physics?.evaluate(cm, t)               // ← 物理按 delta 迭代收敛
    //     pose?.updateParameters(cm, t)          // ← pose 按 delta 累积
    //     cm.update(); cm.loadParameters()
    //   }
    //
    // deltaMS（第一个）必须传真实帧间隔：physics / pose / breath 都是按 dt 收敛的，
    //   传 0 会让它们卡在中间态永不收敛。
    //
    // elapsedMS（第二个）必须传「动作时间轴位置」，即和上面 doUpdateMotion 用同一个值。
    //   ⚠️ 这里曾经传 0，是「播放错位」的根因：
    //     motionManager.update(cm, e) → queueManager.doUpdateMotion(cm, e)
    //     会用 e 求动作进度与淡入权重，而我们对同一帧刚用 S.motionClock 写好了参数，
    //     紧接着这一句又用 0 把它们覆盖回「时间 0」的混合结果。
    //     时间 0 处的 fadeIn 权重是 0 → 动作参数 = 当前值 + (目标值-当前值)*0 = 当前值，
    //     等于动作一个参数都没写进去；画面剩下的只有呼吸/物理/姿势层，
    //     于是人物停在「上一帧的姿势 + 呼吸抖动」上，时间轴却在正常走 —— 即错位。
    //   传 S.motionClock 后，两处求值用同一时刻，权重能正常淡入到 1。
    // 每帧重设要隐藏的部件/网格：im.update() 会按绑定重算 drawable 不透明度，
    // 把我们手工写进去的 0 覆盖掉（部件不透明度不受影响，但一起写更省心）。
    applyHiddenLayers();

    try {
      im.update(dt * 1000, S.motionClock * 1000);
    } catch (err) {
      try { cm.update(); cm.loadParameters(); } catch (e2) {}
    }

    // 播完自动切下一个。
    //   「列表循环」开 → 当前模型全部动作播完后，切到**模型列表**里的下一个模型；
    //   「列表循环」关 → 只在本模型内绕回第 1 个，永远不切模型。
    //
    // ⚠️⚠️ 这里绝不能再按「是否循环动作」分叉（曾经如此）：
    //     zhala_2 的 motion3.json 把 **全部 15 个动作** 都标了 Meta.Loop = true，
    //     于是每个动作都被当成循环动作、靠一个固定的 LOOP_DWELL = 6 秒推走 ——
    //     wedding(31.17s) / login(22.33s) / home(20.17s) 全都在第 6 秒被硬切，
    //     看起来就是「动作播到一半突然跳走」。
    //     正确语义：**不管 Meta.Loop 是什么，都完整播一遍自己的时长再走下一个**。
    //     本 SDK build 的 _isLoop 恒为 false，动作本来就不会自己绕回，播满即止。
    if (!holding && !S._advancing && !S.busyModel) {
      // 队列项为空 = 动作已被 SDK 摘掉（播完）；队列项还在时按时间轴位置判断。
      // t 用 holdTime 兜底：动作播完的那一帧 holdTime 已经停在末尾。
      var t = e ? currentTime() : Math.min(S.holdTime, dur);
      var done = (!e && S.holdTime >= dur - 0.02) || (e && t >= dur - 0.02);
      if (done) {
        var next = S.current + 1;
        if (next < S.motions.length) advanceToMotion(next);
        else if (S.autoPlayAll) advanceToNextModel();
        else advanceToMotion(0);
      }
    }
  }

  // 播到下一个动作：加一道 450ms 的闸，挡住同一帧被重复推进
  // （动作对象是异步加载的，队列项摘掉到下一个动作真正起来之间会隔几帧）
  function advanceToMotion(index) {
    S._advancing = true;
    setTimeout(function () { S._advancing = false; }, 450);
    playMotion(index, true);
  }

  // 「列表循环」的「列表」= 侧栏当前可见的模型（跟着搜索框走）。
  // 到末尾绕回第一个，所以是无限轮播。
  function nextModelInList() {
    var list = visibleModels();
    if (!list.length) return null;
    var i = -1;
    for (var k = 0; k < list.length; k++) {
      if (S.model && list[k].key === S.model.key) { i = k; break; }
    }
    if (i < 0) return list[0];            // 当前模型被搜索过滤掉了 → 从列表第一个重新开始
    return list[(i + 1) % list.length];   // 到末尾绕回第一个
  }

  // 当前模型的全部动作播完了 → 换到列表里的下一个模型。
  // 列表里只有它自己（或搜索把别的都过滤掉了）时没得切，退回「模型内循环」，至少画面不会停。
  function advanceToNextModel() {
    var nm = nextModelInList();
    if (!nm || (S.model && nm.key === S.model.key)) { advanceToMotion(0); return; }
    switchModel(nm);
    // ⚠️ switchModel() 的同步部分会跑 resetPlayState()，把 _advancing 清成 false；
    //    而模型载入要几百毫秒，这期间 tickProgress 还在跑，必须补一道更长的闸，
    //    否则会在载入中途又推进一次（S.current 这时是 -1，会推错）。
    S._advancing = true;
    setTimeout(function () { S._advancing = false; }, 1500);
  }

  // 极少数模型可能一个动作都没有（model3.json 里 Motions 为空）。
  // 那种模型 tickProgress 会直接 return，永远等不到「播完」，列表循环就卡在它身上。
  // 这里按帧轮询把它跳过去；连续跳过数超过列表长度就认输停下 ——
  // 免得「所有模型都没动作」时在这儿无限换模型。
  function tickSkipMotionless() {
    if (!S.autoPlayAll || S.busyModel || !S.playing) return;
    var list = visibleModels();
    if (!list.length || S._skipCount >= list.length) return;
    if (Date.now() - S._skipAt < 600) return;
    S._skipAt = Date.now();
    S._skipCount++;
    advanceToNextModel();
  }

  // ---------- 自动依次播完全部动作 ----------
  // 页面固定处于「依次播完全部动作」模式：模型载入后从第 1 个动作开始，
  // 一个接一个完整播完自己的时长，最后一个播完再回到第 1 个，无限循环。
  //
  // ⚠️ 这里曾经有一个 LOOP_DWELL = 6 秒的「循环动作停留计时」，已删除。
  //    它按「Meta.Loop = true 的动作不会自然播完」来给固定停留时间，
  //    结果把所有标了 Loop 的动作都在第 6 秒硬切。zhala_2 是 15 个动作全标 Loop，
  //    受影响最明显（wedding 31.17s 只播 6s）。现在统一按真实时长推进，
  //    时长缺失的动作用一个兜底值，避免卡死。

  // 动作时长未知时的兜底（正常都能从 motion3.json 的 Meta.Duration 读到）
  var FALLBACK_DUR = 8;

  // 定格队列项的终点时间。必须远大于任何动作时长，让 isFinished() 恒为 false，
  // 否则 doUpdateMotion 会空转、参数写不进去（表现为人物持续抖动）。
  var HOLD_END = 3600;

  // 从定格位置「续播」：重新入队当前动作，并让它在 at 秒处接上。
  //
  // doUpdateMotion 用「t - startTime」当动作进度，startTime 会在首次
  // updateParameters 时被 SDK 重设成当时的 t。所以要续播，就得让 SDK
  // 把 startTime 设成 (当前时钟 - at)，这样 t - startTime 恰好等于 at。
  function resumeMotionAt(at) {
    var mm = motionManager(), cm = coreModel();
    if (!mm || !mm.queueManager || !cm) return;
    var mo = S.motions[S.current];
    if (!mo) return;
    var motionObj = findMotionObject(mm, mo);
    if (!motionObj) { playMotion(S.current, true); return; }
    try {
      var qt = mm.queueManager;
      qt.startMotion(motionObj, false);
      var qe = activeEntry();
      if (!qe) { playMotion(S.current, true); return; }
      var dur = mo.duration || 0;
      qe.setIsStarted(true);          // 同 playMotion：别让 SDK 用当时的 t 重设起点
      qe.setStartTime(0);
      qe.setEndTime(dur > 0 ? dur : HOLD_END);
      // 续播时把淡入起点挪到过去，否则以 at 为 fadeInStart 求weight=0，
      // 参数写不进去（和 mountHoldEntry 同一个坑）。
      qe.setFadeInStartTime(at - motionFadeIn(motionObj) - 0.001);
      S.motionClock = at;
      S.holdTime = at;
      qt._doUpdateTime = at;
      qt.doUpdateMotion(cm, at);
    } catch (err) {
      playMotion(S.current, true);
    }
  }

  // 取动作时长（秒）。优先用 SDK 已解析对象的 getDuration()，
  // 拿不到再退回 probeDurations 从 motion3.json 里读到的值。
  function motionObjectDuration(motionObj, mo) {
    try {
      var d = motionObj && motionObj.getDuration ? motionObj.getDuration() : 0;
      if (typeof d === 'number' && isFinite(d) && d > 0) return d;
    } catch (e) {}
    var d2 = mo && mo.duration;
    return (typeof d2 === 'number' && isFinite(d2) && d2 > 0) ? d2 : 0;
  }

  // 取动作的淡入时长（秒）。SDK 的权重公式用
  //   ease((t - fadeInStartTime) / fadeInSeconds)
  // 所以要让某时刻的权重为 1，必须保证 t - fadeInStartTime >= fadeInSeconds。
  function motionFadeIn(motionObj) {
    try {
      var v = motionObj && motionObj._fadeInSeconds;
      if (typeof v === 'number' && isFinite(v)) return v;
    } catch (e) {}
    return 0.5;
  }


  // 做法：入队后把起点定在 0、终点设成 HOLD_END（一个远超任何动作时长的值），
  // 再把「淡入起点」挪到 holdTime 之前一段，最后以 t = holdTime 求值一次。
  // 之后每帧都以同一个 t 重放，参数恒定不变 —— 画面就稳稳定格住。
  //
  // ⚠️ 这里有两个必须同时满足的条件，缺一个权重就是 0、动作参数根本写不进去
  //    （表现：画面里只有呼吸/物理在动，人物姿势是错的 —— 即「错位」）：
  //
  //   1. endTime 必须远离 holdTime。
  //      权重里有一项 fadeOut = ease((endTime - t) / fadeOutSeconds)，
  //      若 endTime 恰好等于 holdTime，这一项 = ease(0) = 0 → 权重 0。
  //      （SDK 另外还有 isFinished() ⇒ t >= endTime 的判定，同样会让求值被跳过。）
  //
  //   2. fadeInStartTime 必须比 holdTime 早至少 fadeInSeconds。
  //      权重里另一项 fadeIn = ease((t - fadeInStartTime) / fadeInSeconds)，
  //      而 SDK 在「首次 updateParameters」时会把 fadeInStartTime 设成当时的 t。
  //      于是 t == fadeInStartTime ⇒ ease(0) = 0 ⇒ 权重 0。
  //      必须显式把 fadeInStartTime 往回拨。
  //
  // 关键：只挂一次。每帧重新 startMotion 会让动作在起始姿势与末帧之间来回跳。
  function mountHoldEntry(mm, cm, holdTime) {
    if (S.pausedEntry) return;   // 已经挂好了，不要重复入队
    var mo = S.motions[S.current];
    if (!mo) return;
    var motionObj = findMotionObject(mm, mo);
    if (!motionObj) return;
    try {
      var qt = mm.queueManager;
      qt.startMotion(motionObj, false);
      var qe = activeEntry();
      if (!qe) return;
      qe.setIsStarted(true);          // 阻止 SDK 首次求值时把 fadeInStartTime 设成 holdTime
      qe.setStartTime(0);
      qe.setEndTime(HOLD_END);
      var fi = motionFadeIn(motionObj);
      // 往回拨一点点余量，避免浮点误差让 ease() 落在 1 的边界外
      qe.setFadeInStartTime(holdTime - fi - 0.001);
      S.pausedEntry = qe;
      qt._doUpdateTime = holdTime;
      qt.doUpdateMotion(cm, holdTime);
    } catch (err) {}
  }

  // 任何时间轴要恢复「自己推进」的操作（重播 / 换动作 / 取消暂停）都必须清掉这个标记，
  // 否则上一支动作的定格项会继续挂在队列里。
  function clearHoldEntry() {
    S.pausedEntry = null;
  }

  // ---------- 6. 交互 ----------
  var ZOOM_MIN = 20, ZOOM_MAX = 400;
  function clampZoom(p) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, p)); }

  // 鼠标 / 触屏 / 触控笔统一走 pointer 事件：
  //   · 单指（或按住鼠标左键）拖动平移
  //   · 双指捏合缩放（按两指间距的比例换算，手感与系统一致）
  //   · 双击（鼠标）或快速双击（触屏）复位视图
  // ⚠️ 触屏上 dblclick 不一定会触发，所以双击切换动作对非鼠标指针要自己判定。
  function bindStagePanZoom() {
    var stage = els.stage;
    var pts = [];                 // 当前按下的指针 [{id,x,y}]，最多关心前两个
    var pinchDist = 0;            // 上一帧的两指间距
    var multiTouch = false;       // 这一轮手势里出现过两根手指（捏合过就不算双击）
    var lastTapAt = 0, lastTapX = 0, lastTapY = 0;

    function indexOfPt(id) {
      for (var i = 0; i < pts.length; i++) if (pts[i].id === id) return i;
      return -1;
    }
    // ⚠️ 按下时新增、移动时必须更新坐标 —— 只 push 不更新的话，
    //    两指间距会永远停在「第二根手指落下那一刻」的值，捏合就没反应了。
    function track(e, add) {
      var i = indexOfPt(e.pointerId);
      if (add) {
        if (i < 0) pts.push({ id: e.pointerId, x: e.clientX, y: e.clientY });
        else { pts[i].x = e.clientX; pts[i].y = e.clientY; }
      } else if (i >= 0) pts.splice(i, 1);
    }
    function twoFingerDist() {
      if (pts.length < 2) return 0;
      var dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function clearAll() {
      pts.length = 0; pinchDist = 0; multiTouch = false;
      S.dragging = false; S.dragStart = null;
      stage.style.cursor = '';
    }

    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      track(e, true);
      try { stage.setPointerCapture && stage.setPointerCapture(e.pointerId); } catch (err) {}

      if (pts.length >= 2) {
        // 第二根手指落下 = 进入缩放模式，立刻停止平移，否则画面会跟着跑
        multiTouch = true;
        S.dragging = false; S.dragStart = null;
        stage.style.cursor = '';
        pinchDist = twoFingerDist();
        return;
      }
      S.dragging = true;
      S.dragStart = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y };
      stage.style.cursor = 'grabbing';
    });

    stage.addEventListener('pointermove', function (e) {
      track(e, true);

      if (pts.length >= 2) {
        var d = twoFingerDist();
        if (pinchDist > 0 && d > 0) {
          setZoomPercent(clampZoom(currentZoomPercent() * (d / pinchDist)));
        }
        pinchDist = d;
        return;
      }

      if (S.l2dModel && !S.dragging) {
        // 视线跟随
        try {
          var f = S.l2dModel.focus ? S.l2dModel.focus.bind(S.l2dModel) : null;
          if (f) f(e.clientX, e.clientY);
        } catch (err) {}
      }
      if (!S.dragging || !S.dragStart) return;
      S.view.x = S.dragStart.vx + (e.clientX - S.dragStart.x);
      S.view.y = S.dragStart.vy + (e.clientY - S.dragStart.y);
      applyView();
    });

    function endDrag(e) {
      track(e, false);
      if (pts.length < 2) pinchDist = 0;

      // 触屏双击切动作（鼠标那边交给原生 dblclick）。
      // 捏合过的一轮手势不算双击 —— 两根手指一起抬起时位置可能很近，会误判成双击。
      if (e.pointerType && e.pointerType !== 'mouse' && !multiTouch) {
        var now = Date.now();
        var moved = Math.abs(e.clientX - lastTapX) > 30 || Math.abs(e.clientY - lastTapY) > 30;
        if (now - lastTapAt < 320 && !moved) {
          lastTapAt = 0;
          if (S.motions.length && !S.busyModel) {
            var next = (S.current + 1) % S.motions.length;
            advanceToMotion(next);
          }
        }
        else { lastTapAt = now; lastTapX = e.clientX; lastTapY = e.clientY; }
      }

      if (!pts.length) {
        S.dragging = false;
        S.dragStart = null;
        multiTouch = false;
        stage.style.cursor = '';
      }
      try { stage.releasePointerCapture && stage.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    // 抽屉被拉开、切到后台等情况可能收不到 pointerup，兜底清掉按下状态
    window.addEventListener('blur', clearAll);

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    setZoomPercent(clampZoom(currentZoomPercent() * (e.deltaY < 0 ? 1.08 : 0.926)));
  }, { passive: false });

    stage.addEventListener('dblclick', function () {
      if (!S.motions.length || S.busyModel) return;
      var next = (S.current + 1) % S.motions.length;
      advanceToMotion(next);
    });

    // 单击舞台：未播放时点击开始播放；点击模型身体触发 TapBody 等有声动作
    var ptrDownPos = null;
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptrDownPos = { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointerup', function (e) {
      if (ptrDownPos && !S.busyModel) {
        var dx = e.clientX - ptrDownPos.x, dy = e.clientY - ptrDownPos.y;
        if (dx * dx + dy * dy < 225) {
          // 点击模型身体 → 触发 SDK hitTest → 播放对应分组的动作（含语音）
          if (S.l2dModel) {
            try { S.l2dModel.tap(e.clientX, e.clientY); } catch (err) {}
          }
          // 未播放时同时恢复播放
          if (!S.playing) {
            var idx = S.current >= 0 ? S.current : 0;
            playMotion(idx);
          }
        }
      }
      ptrDownPos = null;
    });
  }

  function bindUI() {
    els.btnPlay.addEventListener('click', togglePlay);
    els.btnReset.addEventListener('click', resetView);
    els.btnClearCache.addEventListener('click', clearOtherModelCache);
    els.btnFull.addEventListener('click', toggleFullscreen);
    els.btnExitFs.addEventListener('click', exitFullscreen);
    els.btnExitFs.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

    els.modelSearch.addEventListener('input', renderModels);

    els.speed.addEventListener('input', function () {
      S.speed = parseFloat(els.speed.value) / 100;
      els.speedVal.textContent = S.speed.toFixed(1) + '×';
      saveState();
    });

    els.checkerBg.addEventListener('change', function () { toggleChecker(els.checkerBg.checked); });

    // 「列表循环」：开 → 当前模型全部动作播完后自动切到列表里的下一个模型；
    // 关 → 只在本模型内循环动作，不切模型。
    // 不需要在切换开关时立刻做别的事：开着的时候等「播完」自然会切，
    // 关着的时候本来就一直在本模型内循环，两种状态下画面都不会停。
    els.listLoop.addEventListener('change', function () {
      S.autoPlayAll = els.listLoop.checked;
      S._skipCount = 0;
      saveState();
    });

    els.soundEnabled.addEventListener('change', function () {
      S.soundEnabled = els.soundEnabled.checked;
      if (!S.soundEnabled) stopCurrentAudio();
      saveState();
    });

    els.btnDownload.addEventListener('click', downloadCurrentModel);

    // 本地预览：左下角入口 → 对话框（选文件 / 拖文件都在对话框里），
    // 见「本地预览对话框」那一节
    bindLocalDialog();
    guardFileDrop();
    // 贡献模型：左下角第二个入口 → 对话框（选模型 / 填令牌 / 看清单）
    bindContribDialog();
    refreshContribBtn();
    // 添加外部模型源：侧栏头的 + 按钮 → 对话框（粘 URL / 选源 / 解析预览）
    bindSrcDialog();
    // 部件面板：右下角浮动按钮 + 右抽屉（部件 / 信息/诊断 / 导出画面 / 导出配置）
    bindPartsPanel();

    // 手机端抽屉：顶栏汉堡开关、面板里的 × 、遮罩、选中模型后自动收起
    if (els.btnNav) els.btnNav.addEventListener('click', function () { setNav(!S.navOpen); });
    if (els.btnNavClose) els.btnNavClose.addEventListener('click', function () { setNav(false); });
    if (els.navScrim) els.navScrim.addEventListener('click', function () { setNav(false); });
    if (els.btnNavPin) els.btnNavPin.addEventListener('click', toggleNavPin);
    // 桌面端：鼠标移到左边缘自动展开，移出侧栏 1.5s 后自动折叠（被「固定」时失效）
    document.addEventListener('pointermove', onDocPointerMove, { passive: true });
    document.addEventListener('mouseleave', navHoverClear);
    document.addEventListener('blur', navHoverClear);
    els.modelList.addEventListener('click', function () {
      if (mqMobile.matches) setNav(false);
    });

    // 舞台主题下拉
    els.stageSegBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      els.stageSeg.classList.toggle('open');
    });
    els.stageSegList.addEventListener('click', function (e) {
      var opt = e.target.closest('.stage-dd-opt');
      if (!opt) return;
      setStageTheme(opt.getAttribute('data-stage'));
      els.stageSeg.classList.remove('open');
    });
    document.addEventListener('click', function () { els.stageSeg.classList.remove('open'); });

    window.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      // 对话框开着时键盘只服务于对话框：Esc 关闭、回车 / 空格在虚线框上是「选文件」。
      // 不拦住的话空格会顺手把动作播/停切换掉。
      // 三个对话框（本地预览 / 贡献模型 / 添加外部源）开着时键盘只服务于对话框。
      // 不拦住的话，在令牌输入框里敲空格会顺手把动作播/停切换掉。
      if ((S.localOpen || S.contribOpen || S.srcOpen) && e.key !== 'Escape') return;
      if (e.key === 'ArrowRight') playMotion(S.current + 1);
      else if (e.key === 'ArrowLeft') playMotion(S.current - 1);
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'r' || e.key === 'R') playMotion(S.current);
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 't' || e.key === 'T') cycleStageTheme();
      // P = 切换部件面板（右抽屉）—— FAB 点不到时键盘能开。
      // Esc 优先级按现有顺序排，关闭路径不变。
      else if (e.key === 'p' || e.key === 'P') setRightPane(!S.rightPaneOpen);
      // 浏览器原生全屏由 Esc 自己处理；这里兜底「请求被拒、只剩 CSS 全屏」的情况。
      // 关闭的优先级：贡献对话框 → 本地预览对话框 → 添加外部源 → 右抽屉 → 抽屉 → 全屏，
      // 一次 Esc 只做一件事。
      else if (e.key === 'Escape') {
        if (S.contribOpen) closeContribDialog();
        else if (S.localOpen) closeLocalDialog();
        else if (S.srcOpen) closeSrcDialog();
        else if (S.rightPaneOpen) setRightPane(false);
        // ⚠️ 全屏排在侧栏前面：全屏时侧栏是被 CSS 藏起来的，Esc 若先去折叠它，
        //    用户第一下按下去屏幕上没有任何反应，得按两次才能退出全屏。
        else if (S.fullscreen) exitFullscreen();
        else if (S.navOpen) setNav(false);
      }
    });

    bindViewport();
  }

  // ============================================================
  // 多端适配
  // ============================================================
  // 断点必须和 CSS 里的媒体查询保持一致（含「矮视口」那一条）：
  // 横屏手机宽度够但高度只有 390px 左右，同样要按手机布局走抽屉。
  var mqMobile = window.matchMedia('(max-width: 767px), (max-height: 520px) and (max-width: 1023px)');
  var mqCoarse = window.matchMedia('(hover: none), (pointer: coarse)');

  // ---------- 侧栏：悬停自动展开 / 「固定」开关 ----------
  //
  // 桌面端默认「双重控制」：鼠标移到左边框（≤ 8px）就展开，鼠标移出侧栏区域 1.5s 后自动折叠；
  // 顶栏的汉堡按钮一直都能用。点侧栏头的「固定」按钮（aria-pressed）把悬停行为整个关掉，
  // 只剩汉堡控制 —— 适合专心看舞台的用户。
  // 手机端没悬停可言，这两个都不接。

  var NAV_EDGE_PX = 8;               // 距视口左边多少 px 算「移到边上了」
  var NAV_HOVER_OPEN_MS = 1000;      // 鼠标在左边框**停留**多久才展开（只是划过去不算）
                                     // ⚠️ rain 拍板 1 秒（先试过 1.5 秒，嫌等太久）：
                                     //    挡得掉「蹭到屏幕边缘」「切窗口回来鼠标正好落在边上」
                                     //    这类误触，又不至于让人干等着以为没生效。
                                     //    折叠那边仍是 1.5 秒 —— 收起可以慢一点，那是无所谓的等待。
  var NAV_HOVER_DELAY_MS = 1500;     // 鼠标离开侧栏多久后自动折叠（用户说「几秒」）
  var NAV_HOVER_SUPPRESS_MS = 600;   // 刚收起后这么久内忽略悬停展开（见 setNav 里的说明）
  var navOpenTimer = null;           // 「停留够了就展开」的 setTimeout 句柄
  var navCollapseTimer = null;       // 「离开够久就折叠」的 setTimeout 句柄
  var navSuppressHideUntil = 0;      // 用户刚点了汉堡 / 固定，这段时间内忽略自动折叠
  var navSuppressOpenUntil = 0;      // 侧栏刚收起，这段时间内忽略悬停展开

  function navCancelHide() {
    if (navCollapseTimer) { clearTimeout(navCollapseTimer); navCollapseTimer = null; }
  }

  function navCancelOpen() {
    if (navOpenTimer) { clearTimeout(navOpenTimer); navOpenTimer = null; }
  }

  // ⚠️⚠️ 抑制窗口 ≠ 放弃排队，只是**晚一点**。
  //    原来写成 `if (Date.now() < navSuppressUntil) return;` 会踩一个很阴的坑：
  //    用户刚展开侧栏就把鼠标移开 —— 这一次 navScheduleHide 是**唯一**一次机会
  //    （鼠标停下之后就不再有 pointermove 了），被 return 掉的话侧栏就**永远**不会
  //    自动折叠，一直杵在那儿。
  //    正确做法是把抑制窗口的剩余时间**加到等待时长上**，而不是不排。
  function navScheduleHide() {
    if (S.navPinned || mqMobile.matches || !S.navOpen) return;
    if (navCollapseTimer) return;
    var wait = NAV_HOVER_DELAY_MS;
    var left = navSuppressHideUntil - Date.now();
    if (left > 0) wait += left;
    navCollapseTimer = setTimeout(function () {
      navCollapseTimer = null;
      setNav(false);
    }, wait);
  }

  // ⚠️⚠️ 展开要「停留」才算数，不是一进热区就弹。
  //   鼠标只是**划过**左边框（从侧栏甩向舞台、从别的窗口切回来正好落在边上、
  //   或者手抖蹭到屏幕最左一列像素）不该把侧栏弹出来 —— 那样很吵。
  //   所以进热区只排一个 300ms 的定时器，鼠标真的在那儿停住了才展开。
  function navScheduleOpen() {
    if (S.navPinned || mqMobile.matches || S.navOpen) return;
    if (navOpenTimer) return;
    // 同 navScheduleHide：抑制期间不是「不排」，而是把剩余抑制时间加进去晚点排。
    // 否则「刚按汉堡收起 → 立刻把鼠标移到左边停住」这一次机会被吃掉，
    // 鼠标之后不动了就不再有 pointermove，侧栏永远打不开。
    var wait = NAV_HOVER_OPEN_MS;
    var left = navSuppressOpenUntil - Date.now();
    if (left > 0) wait += left;
    navOpenTimer = setTimeout(function () {
      navOpenTimer = null;
      setNav(true);
    }, wait);
  }

  // 桌面端统一拦一次的悬停判定：
  //   · 在左边 8px 内         → 排展开定时器（已展开就只是取消隐藏定时器）
  //   · 在侧栏 rect 内         → 取消隐藏定时器
  //   · 其它（中间 / 右边 / 全屏）→ 取消还没触发的展开，并给开着的侧栏排上自动折叠
  function onDocPointerMove(e) {
    if (S.navPinned || mqMobile.matches) return;
    // 全屏下侧栏整张 hidden，悬停开了反而碍眼
    if (appEl.classList.contains('fs')) return;
    // 触屏 / 手写笔没有「悬停」这回事，手指划一下别把侧栏弹出来
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var x = e.clientX, y = e.clientY;
    if (x <= NAV_EDGE_PX) {
      // 已经开着 → 立刻取消折叠（不用再等，它已经出来了）
      // 还关着   → 排 300ms，等鼠标真的停住
      if (S.navOpen) navCancelHide();
      else navScheduleOpen();
      return;
    }
    navCancelOpen();   // 离开热区 → 撤销还没触发的展开
    if (S.navOpen) {
      var sb = document.querySelector('.sidebar');
      if (!sb) return;
      var r = sb.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        navCancelHide();
      } else {
        navScheduleHide();
      }
    }
  }

  function applyNavPin() {
    if (els.btnNavPin) els.btnNavPin.setAttribute('aria-pressed', S.navPinned ? 'true' : 'false');
  }

  function toggleNavPin() {
    S.navPinned = !S.navPinned;
    applyNavPin();
    try { saveState(); } catch (e) {}
    // 钉上后别让之前排好的自动折叠 / 自动展开再跑一次
    if (S.navPinned) { navCancelHide(); navCancelOpen(); }
  }

  // 鼠标真正「离开视口」或「按下」也立刻清掉定时器，免得离开页面时还开着后台折叠
  function navHoverClear() { navCancelHide(); navCancelOpen(); }

  // 手机端把侧栏当抽屉用：.app.nav-open 时滑出。
  // 非手机断点下永远保持收起，免得横竖屏来回切换时留下一个半开的抽屉。
  function setNav(open) {
    // 用户主动点了按钮（含「固定」/汉堡）：接下来一小段时间别让悬停再把它自动折叠掉。
    navSuppressHideUntil = Date.now() + 800;
    // ⚠️⚠️ 收起之后的一小段时间内忽略悬停展开，两个原因：
    //   1) 点汉堡收起时鼠标就停在顶栏左上角 —— 那儿正好落在 8px 热区里，鼠标微动一下
    //      就会重新排上展开，用户会觉得「我刚关掉它又弹回来」；
    //   2) 更硬的竞态：展开定时器已经排上了，用户正好在这 300ms 内手动收起，
    //      定时器到期照样 setNav(true) —— 不撤销它就会把刚收起的侧栏再弹开。
    if (!open) navSuppressOpenUntil = Date.now() + NAV_HOVER_SUPPRESS_MS;
    // ⚠️⚠️ 两个定时器都要**无条件**撤销：一次明确的状态切换，就该作废之前排下的
    //    自动展开 / 自动折叠计划。
    //    不撤销 hide 定时器的后果（真实鼠标实测）：侧栏开着时鼠标移到舞台 → 排 1.5s 折叠；
    //    用户在这 1.5s 内主动按汉堡收起 → 那个**陈旧**的定时器照样到期、照样 setNav(false)，
    //    于是 navSuppressOpenUntil 被又刷了 600ms —— 用户紧接着把鼠标移到左边想再打开，
    //    整整 600ms 一点反应都没有，看起来就是「悬停失灵」。
    navCancelOpen();
    navCancelHide();
    if (!mqMobile.matches) {
      // 桌面端：切换侧栏折叠
      S.navOpen = !!open;
      appEl.classList.toggle('sidebar-collapsed', !S.navOpen);
      if (els.btnNav) els.btnNav.setAttribute('aria-expanded', S.navOpen ? 'true' : 'false');
      // 侧栏过渡结束后重排舞台尺寸
      setTimeout(scheduleRelayout, 240);
      return;
    }
    S.navOpen = !!open;
    appEl.classList.toggle('nav-open', S.navOpen);
    if (els.btnNav) els.btnNav.setAttribute('aria-expanded', S.navOpen ? 'true' : 'false');
    if (els.navScrim) els.navScrim.setAttribute('aria-hidden', S.navOpen ? 'false' : 'true');
  }

  // 提示文案按输入方式换：触屏没有滚轮，说「滚轮缩放」等于没说
  function updateHintText() {
    if (!els.stageHint) return;
    els.stageHint.textContent = mqCoarse.matches
      ? '单指拖动移动 · 双指缩放 · 双击切换动作'
      : '按住拖动可移动位置 · 滚轮缩放 · 双击切换动作 · 右上角全屏';
  }

  // 尺寸变化的统一入口。窗口 resize 不够用：手机地址栏收放、横竖屏切换、
  // 侧栏抽屉开合都会改变舞台尺寸，所以直接拿 ResizeObserver 盯住舞台本身。
  var relayoutPending = 0;
  function scheduleRelayout() {
    if (relayoutPending) return;
    relayoutPending = requestAnimationFrame(function () {
      relayoutPending = 0;
      relayout();
    });
  }

  function bindViewport() {
    updateHintText();
    // ⚠️ 断点变化是有方向的：进手机收起抽屉，回桌面把侧栏放回来。
    //    以前无脑 setNav(false)，于是「手机 → 桌面」时侧栏被折叠成 0 宽、
    //    而且没有任何路径能把它展开回来（用户只能刷新）。
    var onMq = function () { setNav(!mqMobile.matches); scheduleRelayout(); };
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', onMq);
    else if (mqMobile.addListener) mqMobile.addListener(onMq);

    if (mqCoarse.addEventListener) mqCoarse.addEventListener('change', updateHintText);
    else if (mqCoarse.addListener) mqCoarse.addListener(updateHintText);

    if (window.ResizeObserver) {
      try { new ResizeObserver(scheduleRelayout).observe(els.stage); } catch (e) {}
    }
    window.addEventListener('resize', scheduleRelayout);
    window.addEventListener('orientationchange', function () {
      // 横竖屏切换后浏览器要过一会儿才把新尺寸算出来，隔两拍再量一次
      scheduleRelayout();
      setTimeout(scheduleRelayout, 260);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleRelayout);
    }
  }

  // 舞台尺寸变了（窗口缩放 / 进出全屏 / 横竖屏 / 地址栏收放）之后重新排布：
  // 渲染器跟着改尺寸，并按原来的缩放百分比重新适配模型。
  // 尺寸没变就直接返回 —— ResizeObserver 会因抽屉动画等反复触发，不做守卫会白跑一堆。
  var lastStageBox = { w: 0, h: 0 };
  function relayout() {
    var box = stageSize();
    if (Math.abs(box.w - lastStageBox.w) < 0.5 && Math.abs(box.h - lastStageBox.h) < 0.5) return;
    lastStageBox = { w: box.w, h: box.h };
    var keep = currentZoomPercent();
    if (S.app) S.app.renderer.resize(box.w, box.h);
    setZoomPercent(keep);
    // ⚠️⚠️ 必须**同步**补一次渲染 —— 否则侧栏展开/折叠时模型会「短暂消失」。
    //    原因：改 canvas.width 会把 WebGL 的绘制缓冲**整个清空**；而 ResizeObserver
    //    是在这一帧的 rAF（PIXI ticker 的渲染）**之后**才跑的，帧内顺序变成
    //      「渲染 → resize 清空 → 绘制」
    //    画出来的就是一张空画布。侧栏有 240ms 过渡，期间每帧都重排一次，
    //    于是整整 240ms 画面都是空的（实测：resize 后最近一次渲染要等 52~58ms）。
    //    这里立刻补一次 render，绘制前画面就已经被重新画上了。
    if (S.app && S.l2dModel) { try { S.app.render(); } catch (e) {} }
  }

  // ---------- 舞台背景：浅色 / 深色 / 黑色 ----------
  // 只改 .stage 上的类，模型本身与渲染器都不动，所以切换是零成本的。
  // 两个深色类都会触发同一批浮层配色（见 CSS 里 .stage.dark / .stage.black 那几组规则）。
  var STAGE_THEMES = ['light', 'dark', 'black'];
  var STAGE_THEME_LABEL = { light: '浅色', dark: '深色', black: '黑色' };

  function setStageTheme(name, silent) {
    if (STAGE_THEMES.indexOf(name) < 0) name = 'dark';
    S.stageTheme = name;
    els.stage.classList.toggle('dark', name === 'dark');
    els.stage.classList.toggle('black', name === 'black');
    els.stageSegDot.style.background = { light:'#f7f9fc', dark:'#1e2531', black:'#000' }[name];
    els.stageSegLabel.textContent = STAGE_THEME_LABEL[name];
    var opts = els.stageSegList.querySelectorAll('.stage-dd-opt');
    for (var i = 0; i < opts.length; i++) opts[i].classList.toggle('on', opts[i].getAttribute('data-stage') === name);
    if (!silent) saveState();
  }

  // 快捷键 T：浅色 → 深色 → 黑色 → 浅色
  function cycleStageTheme() {
    var i = STAGE_THEMES.indexOf(S.stageTheme);
    setStageTheme(STAGE_THEMES[(i + 1) % STAGE_THEMES.length]);
  }

  // ---------- 全屏：整个屏幕只显示模型 ----------
  // 同时做两件事：
  //   1. 请求浏览器原生全屏（连地址栏一起收掉）；
  //   2. 给 .app 加 .fs 类，隐藏顶栏 / 侧栏 / 底部控制条。
  // 第 2 步独立生效，所以即使原生全屏被拒绝（例如页面跑在 iframe 里），
  // 仍然能得到「页面内全屏」的效果。
  function toggleFullscreen() {
    if (S.fullscreen) exitFullscreen(); else enterFullscreen();
  }

  function enterFullscreen() {
    S.fullscreen = true;
    // ⚠️ 只在「手机抽屉」模式下收起侧栏。桌面端的 setNav(false) 是真的把侧栏折叠掉
    //    （.sidebar-collapsed → 宽度归 0），而退出全屏没人把它展开回来 ——
    //    表现为退出后侧栏凭空消失、舞台比进入前宽了一截。
    //    桌面全屏时侧栏本来就由 .app.fs .sidebar 隐藏，不需要动状态。
    if (mqMobile.matches) setNav(false);   // 抽屉开着进全屏，退出时会莫名其妙地又冒出来
    closeLocalDialog();       // 同理：全屏里侧栏（也就是「本地预览」入口）是藏起来的，
                              // 对话框却挂在舞台上会一直留在屏幕中间
    closeContribDialog();     // 上传中它自己会拒绝关闭（进度要留给用户看），其余情况同上
    appEl.classList.add('fs');
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      try {
        var p = req.call(el);
        if (p && p.catch) p.catch(function () { /* 被拒绝也没关系，CSS 全屏已经生效 */ });
      } catch (e) {}
    }
    syncFullscreenLayout();
  }

  function exitFullscreen() {
    S.fullscreen = false;
    appEl.classList.remove('fs');
    var d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement || d.msFullscreenElement) {
      var ex = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
      if (ex) {
        try {
          var p = ex.call(d);
          if (p && p.catch) p.catch(function () {});
        } catch (e) {}
      }
    }
    syncFullscreenLayout();
  }

  // 隐藏/显示面板要等下一帧才反映到 getBoundingClientRect，所以延后一帧再重排
  function syncFullscreenLayout() {
    requestAnimationFrame(relayout);
  }

  // 用户按 Esc（或浏览器自己退出全屏）时，把页面状态同步回来
  function bindFullscreenSync() {
    ['fullscreenchange', 'webkitfullscreenchange', 'MSFullscreenChange'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        var on = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
        // 只在「浏览器确实已经退出全屏」时收掉 CSS 全屏，
        // 否则请求还没返回就会被这个事件误清掉。
        if (!on && S.fullscreen) {
          S.fullscreen = false;
          appEl.classList.remove('fs');
          syncFullscreenLayout();
        }
      });
    });
  }

  /* 棋盘底：只给 .stage 加/去一个 class，背景由 CSS 画（conic-gradient 棋盘格）。
     ⚠️ 早先的「显示网格」是在 PIXI 舞台上画 Graphics 网格线的，那样有两个毛病：
        · 网格画在模型**底下**（addChildAt(g,0)），但会跟着缩放/平移一起动，不像"背景"；
        · 每次 relayout 都要重画一遍。
        改成 CSS 背景后：不动、不重画、缩放平移都不影响，纯背景。 */
  function toggleChecker(on, silent) {
    S.checkerOn = !!on;
    if (els.stage) els.stage.classList.toggle('checker', !!on);
    if (!silent) saveState();
  }

  // ---------- 7. 启动 ----------
  function initPixi() {
    var box = stageSize();
    S.app = new PIXI.Application({
      width: box.w,
      height: box.h,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      powerPreference: 'high-performance'
    });
    els.host.appendChild(S.app.view);
    S.app.view.style.position = 'absolute';
    S.app.view.style.inset = '0';
  }

  function boot() {
    if (!window.Live2DCubismCore) {
      showOverlay('Live2D Cubism Core 未加载', '找不到 assets/live2dcubismcore.min.js', true, false);
      return;
    }
    if (!window.PIXI || !PIXI.live2d) {
      showOverlay('渲染库未加载', 'pixi.min.js 或 cubism4.min.js 加载失败', true, false);
      return;
    }
    initPixi();
    // 必须在任何模型载入之前打好：本地导入的模型全靠它（见函数上方说明）
    patchModelSettingsResolveURL();
    // 模型资源基址：必须在 discoverModels() 之前定好，否则读 models.json 时
    // 还没决定是走本机相对路径还是 raw/CDN 的绝对地址。
    S_baseCandidates = buildBaseCandidates();
    S_modelsBase = S_baseCandidates.length ? S_baseCandidates[0] : '';
    S_baseName = baseName(S_modelsBase);
    bindStagePanZoom();
    bindUI();
    bindFullscreenSync();
    // 手机端侧栏默认收起
    if (mqMobile.matches) { S.navOpen = false; if (els.btnNav) els.btnNav.setAttribute('aria-expanded', 'false'); }
    setupRepoLink();

    var st = loadState();
    // 舞台主题：新版存字符串 st.stage；老版本存的是布尔 st.dark，一并兼容
    if (st && (typeof st.stage === 'string' || st.dark)) {
      setStageTheme(typeof st.stage === 'string' ? st.stage : (st.dark ? 'dark' : 'light'), true);
    }
    if (st && typeof st.speed === 'number') {
      S.speed = st.speed;
      els.speed.value = String(Math.round(st.speed * 100));
      els.speedVal.textContent = S.speed.toFixed(1) + '×';
    }
    S.collapsed = (st && st.collapsed && typeof st.collapsed === 'object') ? st.collapsed : {};

    // 「列表循环」开关：老用户没存过这个字段时保持默认（关）。
    // 注意这里只是把勾选状态摆正，不要去触发 change 回调（程序化改 .checked 本来也不触发）。
    if (st && typeof st.listLoop === 'boolean') {
      S.autoPlayAll = st.listLoop;
      els.listLoop.checked = st.listLoop;
    }
    if (st && typeof st.soundEnabled === 'boolean') {
      S.soundEnabled = st.soundEnabled;
      els.soundEnabled.checked = st.soundEnabled;
    }
    // 棋盘底：默认**开**（2026-09-23 rain 要求）。
    // ⚠️ 不能只在「存过这个字段」时才应用 —— 那样首次访问（localStorage 里什么都没有）
    //    会出现「复选框打着勾、舞台却不画棋盘」的半生效状态：勾选态来自 HTML 的 `checked`，
    //    而 `.checker` class 没人加。所以缺省分支也要显式落一次。
    if (st && typeof st.checkerBg === 'boolean') {
      S.checkerOn = st.checkerBg;
      els.checkerBg.checked = st.checkerBg;
    }
    if (els.stage) els.stage.classList.toggle('checker', S.checkerOn);
    els.checkerBg.checked = S.checkerOn;
    if (st && typeof st.navPinned === 'boolean') {
      S.navPinned = st.navPinned;
      applyNavPin();
    }

    showOverlay('正在扫描模型…', '', false, true);

    discoverModels().then(function (list) {
      S.models = list;
      if (!S.models.length) {
        showOverlay(
          '没有找到任何模型',
          '把 Live2D 模型文件夹（含 .model3.json）直接放进 models/ 目录即可，支持多层嵌套。' +
          '本地用 file:// 打开时浏览器不允许列目录，请改用 HTTP 服务器访问，或先运行 python models_tool.py 生成 models.json。',
          true, false
        );
        return;
      }

      // 记录发现来源，便于排查
      var srcFrom = (S.source === 'index')
        ? 'models.json（' + (S_modelsBase ? S_modelsBase + 'models.json' : '随页面同源') + '）'
        : '内置兜底清单';
      var branchNow = S_branchByBase[S_modelsBase] || '';
      var baseFrom = S_modelsBase
        ? (S_baseName === 'accel' ? (accelLabel(S_accelBase) || '第三方加速地址') : 'raw.githubusercontent.com') +
          (branchNow ? ' · ' + branchNow + ' 分支' : '')
        : '本机同源（models/ 就在页面旁边）';
      els.modelCount.title = '清单来源：' + srcFrom + '\n模型来源：' + baseFrom;

      renderModels();
      // 选初始模型，优先级：?model= 参数 > localStorage 记忆 > 列表第一个
      var pick = S.models[0], pickKey = wantModelFromURL();
      if (!pickKey && st && st.model) pickKey = st.model;
      if (pickKey) {
        for (var i = 0; i < S.models.length; i++) {
          if (S.models[i].key === pickKey) { pick = S.models[i]; break; }
        }
      }
      switchModel(pick);
      S.app.ticker.add(tickProgress);

      // 只读调试面板：这个 SDK 的内部状态（动作队列、自维护时钟）不好从外部观察，
      // 出问题时在控制台执行 __viewer.info() 就能看到关键量。不参与任何页面逻辑。
      try {
        window.__viewer = {
          S: S, els: els, app: S.app,
          mm: motionManager,
          handleLocalZip: handleLocalZip,
          // 模型资源基址快照（只读）：页面/模型分离后，「模型到底从哪个源取的」
          // 是排查问题的第一现场 —— 是走了 GitHub 原始地址？兜底切到哪个加速站？还是被判成本机同源？
          base: function () {
            return {
              base: S_modelsBase,
              cands: S_baseCandidates.slice(),
              name: S_baseName,
              accelBase: S_accelBase,
              forced: S_forcedSrc,
              branch: S_branchByBase[S_modelsBase] || '',
              local: isLocalHost(),
              source: S.source
            };
          },
          // 侧栏悬停调试入口（自动化验收 / 排查用）：**只读**快照，
          // 用来看「展开定时器到底排上没有」「抑制窗口还剩多久」。
          // ⚠️ 合成事件（`document.dispatchEvent(new PointerEvent(...))`）验不出真实鼠标
          //    的问题，排查时一定要配合 CDP 的真实 `Input.dispatchMouseEvent` 看这个快照。
          nav: function () {
            return {
              navOpen: !!S.navOpen,
              pinned: !!S.navPinned,
              mobile: !!mqMobile.matches,
              openTimer: !!navOpenTimer,
              hideTimer: !!navCollapseTimer,
              suppressOpenLeft: Math.max(0, navSuppressOpenUntil - Date.now()),
              suppressHideLeft: Math.max(0, navSuppressHideUntil - Date.now()),
              edge: NAV_EDGE_PX,
              openMs: NAV_HOVER_OPEN_MS
            };
          },
          // 部件面板调试入口（自动化验收用）
          parts: {
            open: function () { setRightPane(true); },
            close: function () { setRightPane(false); },
            toggle: function () { setRightPane(!S.rightPaneOpen); },
            render: renderParts,
            renderInfo: renderInfo,
            clear: clearAllOverrides,
            exportShot: exportShot,
            exportConfig: exportConfig,
            toggleSolo: toggleSolo,
            setSubtree: setSubtree,
            updateFab: updateFabBadge
          },
          // 「贡献模型」调试入口。⚠️ upload() 会真的往 GitHub 发请求 ——
          // 自动化验收必须先用 CDP 把 api.github.com 拦掉，别在真实仓库上跑。
          contrib: {
            list: function () {
              return localModelList().map(function (m) {
                return {
                  key: m.key, name: m.name,
                  files: (m._local.files || []).map(function (f) { return f.rel; })
                };
              });
            },
            target: function (key) {
              var l = localModelList();
              for (var i = 0; i < l.length; i++) if (!key || l[i].key === key) return contribTarget(l[i]);
              return null;
            },
            repo: contribRepo,
            repoInfo: contribRepoInfo,
            repoUI: syncContribRepoUI,
            open: openContribDialog,
            close: closeContribDialog,
            forget: forgetSavedToken,
            sanitize: sanitizeToken,
            setToken: function (t) {
              contribTokenMem = t || '';
              if (els.contribToken) els.contribToken.value = t || '';
            },
            upload: function (key, token) {
              var l = localModelList(), m = null;
              for (var i = 0; i < l.length; i++) if (l[i].key === key) m = l[i];
              if (!m) return Promise.reject(new Error('没有这个本地模型：' + key));
              contribTokenMem = token || '';
              return uploadModelToRepo(m, token || '', function () {});
            }
          },
          // 「添加外部模型源」调试入口。⚠️ addByUrl() 会真的去 fetch 那个 URL —— 自动化
          // 验收要先把远端域名拦掉，或者喂它一个本地 fake。
          extSrc: {
            // 直接传一个 URL 字符串，弹窗里走过的解析 + 拉清单 + 合并流程全部在这里重做
            addByUrl: function (url) { return addExternalSource(parseExternalUrl(url)); },
            // 已经解析好的 {owner, repo, branch, source, base} 对象（自动化测试自己拼）
            add: function (info) { return addExternalSource(info); },
            // 最近一次添加的「选源结论」（source/base/accel）—— 只读快照
            lastAdd: function () { return lastAddInfo; },
            // 按 owner 移除整组
            remove: function (owner) { removeExternalSource(owner); },
            // 当前在 S.models 里的所有外部模型（只读快照）
            list: function () {
              return S.models.filter(function (m) { return !!m._external; })
                .map(function (m) { return { key: m.key, owner: m._external.owner, repo: m._external.repo,
                                            branch: m._external.branch, source: m._external.source,
                                            accel: m._external.accel || '', base: m._external.base,
                                            path: m.path, file: m.file, name: m.name }; });
            },
            // UI 操作：开 / 关弹窗
            open: openSrcDialog,
            close: closeSrcDialog,
            // 模拟在弹窗里改「源」下拉（自动化可验证下拉与预览联动）。
            //   kind 取 'github' | 'accel'；给了 accelBase 就选到那个加速站
            //   （匹配不到预设 → 自动落到「自定义」并填进小输入框）。
            // ⚠️ 默认**只暂存**（与真实 change 事件同一条路）：不换源、不落盘。
            //    要给「用户在真实页面里亲手改的」那一态（即换源已生效）就传 commit=true。
            setKind: function (kind, accelBase, commit) {
              buildSrcKindOptions();
              if (kind === 'github') applySrcAccel('');
              else applySrcAccel(accelBase || (ACCEL_PRESETS[0] && ACCEL_PRESETS[0].base));
              refreshSrcPreview();
              stageSrcChange();
              if (!commit) return false;
              // ⚠️ 别写成 `return commitSrcChange() && !!renderModels()` —— renderModels()
              //    没有返回值（undefined），`!!undefined` 是 false，会把整条表达式按成 false：
              //    源其实换成功了，返回值却说「没换」。M5/M8 就是这么假红的。
              var moved = commitSrcChange();
              if (moved) renderModels();
              return moved;
            },
            // 暂存 → 确认（等价于点「读取并添加」那一下）
            commit: function () { var m = commitSrcChange(); if (m) renderModels(); return m; },
            // 丢弃未确认的改动并还原（等价于点「取消」）
            cancel: function () { var m = revertSrcDialog(); if (m) renderModels(); return m; },
            // 直接调换源逻辑（不碰下拉）—— 探针测「advanceModelsBase 之后不被覆盖」这类
            // 竞态时要能单独调它，绕开 UI。
            repin: function (kind) { return repinModelsBase(kind); },
            // 当前下拉选中的值（探针断言用）：{sel, kind, accel, customRow}
            pick: function () {
              buildSrcKindOptions();
              return {
                sel: pickedSrcSel(),
                kind: pickedSrcKind(),
                accel: pickedAccelBase(),
                customRow: !!(els.srcAccelRow && !els.srcAccelRow.hidden)
              };
            },
            // 内置加速站清单（只读）—— 探针要核对下拉里确实列了这些
            accelPresets: function () {
              return ACCEL_PRESETS.map(function (p) { return { label: p.label, base: normalizeAccelBase(p.base) }; });
            },
            knownAccelBases: knownAccelBases,
            accelerate: accelerate,
            // 弹窗里的预览快照（自动化验证预览）
            preview: function () {
              return {
                repo: (els.srcRepo && els.srcRepo.textContent) || '',
                branch: (els.srcBranch && els.srcBranch.textContent) || '',
                effective: (els.srcEffective && els.srcEffective.textContent) || '',
                valid: els.srcPreview && !els.srcPreview.classList.contains('invalid')
              };
            },
            // URL 解析（不发起网络）—— 自动化可以拿它核对解析逻辑
            parse: parseExternalUrl,
            // 给定一个外部 info，构造另一个镜像（github ↔ accel）
            altBase: altBase,
            // 只走「合进 S.models + 渲染」不走网络 —— 验收脚本喂假数据用。
            // 接受 info 和 rawList（与 fetchExternalModelsJson 返回值同结构）。
            // ⚠️ 不调 switchModel：外部模型切过去会真去 fetch 该仓库下的模型文件，
            //    测试用的假数据没那些文件，会走到 switchModel 的 catch 路径污染 S.model。
            //    想测「能切到外部模型」请走 extSrc.add()（会真拉清单 → 真载入）。
            injectForTest: function (info, rawList) {
              var added = mergeExternalModels(info, rawList);
              renderModels();
              return added;
            }
          },
          playMotion: playMotion,
          togglePlay: togglePlay,
          toggleFullscreen: toggleFullscreen,
          setStageTheme: setStageTheme,
          cycleStageTheme: cycleStageTheme,
          // 自动化要能直接跳到某个动作，否则只能干等（一次动辄十几秒）。
          // ⚠️ 别删：_probe_cycle.js 和 _regress.js 的「切背景不影响播放」都靠它取样。
          playMotion: function (i) { playMotion(i); return S.current; },
          switchModel: function (key) {
            for (var i = 0; i < S.models.length; i++) {
              if (S.models[i].key === key) return switchModel(S.models[i]);
            }
            return undefined;   // 找不到这个 key
          },
          // 模型是否已经切到位（自动化测试要等它变成 true 再采样）
          switchedTo: function (key) { return !!(S.model && S.model.key === key && !S.busyModel); },
          // 把当前模型的整条文件夹路径展开（含外部源的「源」层）。自动化要验「切到
          // 外部源里的模型时会逐层展开」——那件事由 loadIntoStage 末尾自动触发，
          // 而测试环境里外部模型载不进来（假清单没有模型文件），所以留个手动入口。
          revealActive: function () { revealActiveModel(); return folderKeysOf(S.model || {}); },
          snap: function () {
            var cm = coreModel();
            if (!cm) return null;
            return Array.prototype.slice.call(cm._model.parameters.values);
          },
          // 调试读数：core 里部件 / 网格的**实际**不透明度与可见标记。
          // 用来验证「无动作模型（如 Celeste）下，部件面板的调节能实时写进 core」——
          // 这是「控制中心调节不及时生效」这类 bug 的硬判据（覆盖写在 cm.update 钩子里）。
          coreOpacities: function () {
            var core = _coreRaw();
            if (!core || !core.parts) return null;
            return {
              parts: Array.prototype.slice.call(core.parts.opacities),
              drawFlags: core.drawables ? Array.prototype.slice.call(core.drawables.dynamicFlags) : null
            };
          },
          // 导出配置对象的实时副本（与「导出配置」按钮下载的是同一份）。
          // 自动化用它核对「调节后导出的数据是否完整」——
          // 这是「导出配置数据不全」这类 bug 的硬判据。
          configObj: function () { return buildConfigObj(); },
          // 调试入口：手动重跑一次隐藏覆盖（回归测试会关掉 ticker 单独出图，
          // 那时 tickProgress 不再跑，需要能手动触发一次）。
          applyHidden: function () { applyHiddenLayers(); return 1; },
          // 队列项内部状态：抖动/错位排查时最常看的几个量。
          // 定格/暂停时队列里挂的是 S.pausedEntry，activeEntry() 也能拿到它；
          // 但刚播完那一瞬间队列可能已空、定格项还没挂上，所以这里回落到 S.pausedEntry。
          entry: function () {
            var e = activeEntry() || S.pausedEntry;
            if (!e) return null;
            var mo = e._motion;
            return {
              start: e.getStartTime(), end: e.getEndTime(),
              fadeInStart: e.getFadeInStartTime(), started: e.isStarted(),
              finished: e.isFinished(), weight: e.getStateWeight(),
              mWeight: mo && mo.getWeight ? mo.getWeight() : null,
              fadeInSec: mo ? mo._fadeInSeconds : null,
              fadeOutSec: mo ? mo._fadeOutSeconds : null,
              dur: mo && mo.getDuration ? mo.getDuration() : null,
              // ⚠️ mo.isLoop() 在本 SDK build 里恒为 false（setIsLoop 从未被调用），
              //    所以这里给的是「本地权威标记」，别拿 SDK 那个值判断循环。
              loop: isCurrentLoop(),
              sdkLoop: mo && mo.isLoop ? mo.isLoop() : null
            };
          },
          // 动作对象加载情况：null 表示该下标还没加载出来
          groups: function () {
            var mm2 = motionManager();
            if (!mm2) return null;
            var out = {};
            for (var g in (mm2.motionGroups || {})) {
              var defs = (mm2.definitions && mm2.definitions[g]) || [];
              out[g] = (mm2.motionGroups[g] || []).map(function (o, i) {
                if (!o) return null;
                return defs[i] ? defs[i].File : '?';
              });
            }
            return out;
          },
          info: function () {
            var m = motionManager();
            var e = activeEntry();
            return {
              model: S.model && S.model.key,
              source: S.source,
              motions: S.motions.length,
              current: S.current,
              playing: S.playing,
              autoPlayAll: S.autoPlayAll,
              fullscreen: S.fullscreen,
              stageTheme: S.stageTheme,
              speed: S.speed,
              clock: S.motionClock,
              t: currentTime(),
              dur: currentDuration(),
              holdTime: S.holdTime,
              finished: S.finished,
              paused: !!S.pausedEntry,
              holdIsActive: !!S.pausedEntry && e === S.pausedEntry,
              autoUpdate: S.l2dModel && S.l2dModel.autoUpdate,
              queueLen: m && m.queueManager ? (m.queueManager._motions || []).length : -1,
              hasEntry: !!e,
              entryStart: e ? e.getStartTime() : null,
              entryEnd: e ? e.getEndTime() : null,
              // ⚠️ 这个值是最重要的健康指标：动作权重。正常播放时必须收敛到 1；
              //    如果是 0，说明动作参数根本没被写进模型（画面 = 只有呼吸/物理）。
              entryWeight: e ? e.getStateWeight() : null,
              tickerStarted: S.app.ticker.started
            };
          },
          // 部件面板当前的覆盖（部件不透明度 + 被隐藏的网格下标）
          hidden: function () {
            var po = {};
            for (var k in S._partOp) if (_has(S._partOp, k)) po[k] = S._partOp[k];
            var dh = [];
            for (var k2 in S._drawHide) if (_has(S._drawHide, k2)) dh.push(+k2);
            return { partOp: po, drawHide: dh };
          },
          applyHidden: function () { applyHiddenLayers(); return 1; },
          // 「列表循环」的诊断：侧栏可见列表的顺序、当前在第几个、下一个该是谁
          listInfo: function () {
            var list = visibleModels();
            var nm = nextModelInList();
            var idx = -1;
            for (var i = 0; i < list.length; i++) {
              if (S.model && list[i].key === S.model.key) { idx = i; break; }
            }
            return {
              count: list.length,
              index: idx,
              next: nm ? nm.key : null,
              keys: list.map(function (m) { return m.key; }),
              skipCount: S._skipCount,
              autoPlayAll: S.autoPlayAll
            };
          },
          // 打包下载：回归测试要拿真实字节去校验 zip 结构（签名 / CRC / 中央目录），
          // 所以把纯打包函数暴露出来；download 那层会直接触发浏览器下载，不适合自动化。
          pack: function () { return packCurrentModel(); },
          download: function () { downloadCurrentModel(); return 1; },
          // 本地预览：自动化验收直接喂一个 File / Blob 进来（走的是和点按钮完全一样的流程）
          importLocal: function (file) { handleLocalZip(file); return 1; },
          // 对话框：验收要能开、能关、能查里面的文案与拖拽状态
          openLocal: function () { openLocalDialog(); return 1; },
          closeLocal: function () { closeLocalDialog(); return 1; },
          localDialog: function () {
            var m = els.localModal, d = els.localDrop, e2 = els.localErr;
            return {
              open: !!S.localOpen,
              hidden: m ? !!m.hidden : null,
              zIndex: m ? getComputedStyle(m).zIndex : null,
              dropOver: d ? d.classList.contains('over') : null,
              dropText: d ? d.textContent.replace(/\s+/g, ' ').trim() : '',
              reqText: m ? (function () {
                var u = m.querySelector('.req-list');
                return u ? u.textContent.replace(/\s+/g, ' ').trim() : '';
              })() : '',
              reqItems: m ? m.querySelectorAll('.req-list li').length : 0,
              errVisible: e2 ? !e2.hidden : null,
              errText: e2 ? e2.textContent : '',
              statusVisible: els.localStatus ? !els.localStatus.hidden : null,
              statusText: els.localStatusText ? els.localStatusText.textContent : '',
              // 入口按钮：位置、尺寸、文案、图标有没有被「处理中…」抹掉
              btnText: els.btnLocalText ? els.btnLocalText.textContent : null,
              btnIcon: !!(els.btnLocal && els.btnLocal.querySelector('svg'))
            };
          },
          localInfo: function () {
            var locals = S.models.filter(function (m) { return !!m._local; });
            return {
              count: locals.length,
              keys: locals.map(function (m) { return m.key; }),
              groups: locals.map(function (m) { return m.group; }),
              total: S.models.length,
              current: S.model ? S.model.key : null,
              currentIsLocal: !!(S.model && S.model._local),
              motions: S.motions.map(function (mo) { return mo.base; }),
              uploading: S.uploading,
              dialogOpen: !!S.localOpen,
              pendingRevoke: (S._deadUrls || []).length,
              absUrlPatched: !!(PIXI.live2d.ModelSettings &&
                                PIXI.live2d.ModelSettings.prototype.__l2dAbsUrlPatched),
              toastCount: els.toastHost ? els.toastHost.children.length : 0
            };
          },
          // 提示条内容（验收要看「拒绝时到底提示了什么」）
          toasts: function () {
            if (!els.toastHost) return [];
            return [].map.call(els.toastHost.children, function (el) {
              var m = el.querySelector('.tm'), d = el.querySelector('.td');
              return { type: el.className.replace('toast', '').replace('out', '').trim(),
                       msg: m ? m.textContent : '', detail: d ? d.textContent : '' };
            });
          }
        };
      } catch (e) { /* 调试钩子失败不影响页面 */ }
    }).catch(function (err) {
      var reasons = (err && err.reasons) || [err && err.message].filter(Boolean);
      showOverlay(
        '没有找到任何模型',
        '把 Live2D 模型文件夹（内含 .model3.json）整个放进 models/ 目录即可，支持多层嵌套。\n' +
        '本地打开时浏览器不允许列目录，请用 HTTP 服务器访问（python -m http.server），' +
        '或先运行 python models_tool.py 生成 models.json。\n' +
        (reasons.length ? '\n各级尝试的结果：\n· ' + reasons.join('\n· ') : ''),
        true, false
      );
    });
  }

  // 兜底清单：models.json 不可用时使用。
  // 形状与 decorate() 的输入一致：{ path, file, name }
  //   path —— 模型相对 models/ 的目录，多层用 '/' 连接（模型直接放在 models/ 根下时才用 ''）
  //   file —— 该目录下的 .model3.json 文件名
  // 这里只保留一个模型，只为保证「什么都读不到」时页面仍能起来；
  // 正常情况下走 A/B 两级，模型列表是完整的。
  window.MODELS_FALLBACK = [
    { path: 'Azue Lane(JP)/aimierbeierding_2', file: 'aimierbeierding_2.model3.json', name: 'aimierbeierding_2' }
  ];

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
