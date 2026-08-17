/* ==========================================================================
 * 《运程》个人运势解读小工具 - 核心推演逻辑
 * --------------------------------------------------------------------------
 * 说明：
 *   本文件为纯前端确定性推演引擎。所有结果由「稳定种子」唯一决定，
 *   只要输入资料与目标时间维度不变，多次刷新结果完全一致。
 *
 * 推演方法（融合，权重可调）：
 *   ① 四柱八字  —— 由公历生日推算生年干支、日干支（距 1900-01-31 的干支日序）
 *   ② 紫微斗数  —— 以出生时辰与年干支简化为「命宫星曜」强度
 *   ③ 六爻 / 梅花易数 —— 以生日数字成卦（年月日之和 → 梅花卦数）
 *   ④ 星座      —— 生日 ± 周期映射五行属性
 *   ⑤ 血型      —— 能量倾向修正
 *   ⑥ MBTI      —— 四维特质叠加修正
 *
 * 种子构造：
 *   seed = 稳定个人信息散列(个人资料) ⊕ 目标时间维度锚点(日期/周/月/年)
 *   再经 mulberry32 伪随机可复现地生成各项数值。
 * --------------------------------------------------------------------------
 * 免责声明：本工具仅为「确定性娱乐算法」演示，不构成任何占卜或现实建议。
 * ========================================================================== */

(function () {
  'use strict';

  /* ======================== 一、公共工具函数 ======================== */

  /** 确定性字符串散列（FNV-1a 32bit），保证同输入得同值 */
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** 多参数整数散列叠加为单一 32 位种子 */
  function mixSeeds() {
    var h = 0x9e3779b9;
    for (var i = 0; i < arguments.length; i++) {
      var x = arguments[i] >>> 0;
      x = Math.imul(x, 2654435761);
      x = (x ^ (x >>> 13)) >>> 0;
      h = (Math.imul(h, 2246822519) ^ x) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * mulberry32 伪随机数生成器：给定 32 位种子，可复现地生成 [0,1) 序列。
   * 同一种子永远产生相同的随机序列，保证推演可复现。
   */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 依据随机源从数组随机取一项 */
  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  /** 依据随机源在 [min,max] 间取整数 */
  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  /** 依据随机源从数组取不重复的 n 项 */
  function pickN(rng, arr, n) {
    var copy = arr.slice();
    var out = [];
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    }
    return out;
  }

  /**
   * 计算个人稳定种子：仅由个人资料决定，与时间维度无关。
   * 抽取为独立函数，供「整体运势」(buildFortune) 与「一事专断」(buildMatterFortune)
   * 共用同一个个人基础，保证两条分支对同一个人、同一时间维度具有可对齐的确定性。
   * 注：拼接内容的顺序与字段完全保持与原 buildFortune 内部一致，绝不改动既有可复现性。
   */
  function computePersonalSeed(profile) {
    var personalStr = [
      profile.name || '无名',
      profile.gender || '',
      profile.birthKey || 'no-birth', // 含生日+时辰的唯一键
      profile.constellation || '',
      profile.blood || '',
      profile.mbti || ''
    ];
    // 出生地：仅当用户填写时才条件拼接进种子；
    // 未填时 personalStr 与旧版完全一致（同样 6 项、同样 '|' 连接），不破坏既有结果。
    if (profile.birthPlace) {
      personalStr.push(profile.birthPlace);
    }
    return hashString(personalStr.join('|'));
  }

  /* ======================== 二、基础命理数据 ======================== */

  /* 十天干、十二地支、五行 */
  var GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  var ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  var WUXING = {
    '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土',
    '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水',
    '子': '水', '丑': '土', '寅': '木', '卯': '木', '辰': '土', '巳': '火',
    '午': '火', '未': '土', '申': '金', '酉': '金', '戌': '土', '亥': '水'
  };

  /* 十二时辰对应的地支索引 */
  var HOUR_ZHI = {
    '23': 0, '0': 0, '1': 1, '3': 4, '5': 4, '7': 7, '9': 9, '11': 11, '13': 12,
    '15': 15, '17': 16, '19': 19, '21': 20
  };

  /* 星座五行属性映射（用于推演加成） */
  var STAR_WUXING = {
    aries: '火', taurus: '土', gemini: '风', cancer: '水',
    leo: '火', virgo: '土', libra: '风', scorpio: '水',
    sagittarius: '火', capricorn: '土', aquarius: '风', pisces: '水'
  };

  /* 出生地城市表：城市键 → { name 中文名, lon 经度(参考), dir 方位 }。
   * 方位按中国地理相对中原（约 113.5E, 34N）粗略人工标注，仅作方位五行参考，
   * 不用于严格真太阳时校正（表单时辰粒度为 2 小时，无法精确到分钟）。 */
  var BIRTH_PLACES = {
    beijing:      { name: '北京',     lon: 116.4, dir: 'north' },
    tianjin:      { name: '天津',     lon: 117.2, dir: 'north' },
    shijiazhuang: { name: '石家庄',   lon: 114.5, dir: 'north' },
    taiyuan:      { name: '太原',     lon: 112.5, dir: 'north' },
    hohhot:       { name: '呼和浩特', lon: 111.7, dir: 'north' },
    shenyang:     { name: '沈阳',     lon: 123.4, dir: 'north' },
    harbin:       { name: '哈尔滨',   lon: 126.6, dir: 'north' },
    shanghai:     { name: '上海',     lon: 121.5, dir: 'east' },
    nanjing:      { name: '南京',     lon: 118.8, dir: 'east' },
    hangzhou:     { name: '杭州',     lon: 120.2, dir: 'east' },
    hefei:        { name: '合肥',     lon: 117.3, dir: 'east' },
    jinan:        { name: '济南',     lon: 117.0, dir: 'east' },
    qingdao:      { name: '青岛',     lon: 120.4, dir: 'east' },
    taipei:       { name: '台北',     lon: 121.5, dir: 'east' },
    wuhan:        { name: '武汉',     lon: 114.3, dir: 'center' },
    zhengzhou:    { name: '郑州',     lon: 113.6, dir: 'center' },
    changsha:     { name: '长沙',     lon: 113.0, dir: 'south' },
    nanchang:     { name: '南昌',     lon: 115.9, dir: 'south' },
    fuzhou:       { name: '福州',     lon: 119.3, dir: 'south' },
    guangzhou:    { name: '广州',     lon: 113.3, dir: 'south' },
    shenzhen:     { name: '深圳',     lon: 114.1, dir: 'south' },
    xiamen:       { name: '厦门',     lon: 118.1, dir: 'south' },
    nanning:      { name: '南宁',     lon: 108.3, dir: 'south' },
    haikou:       { name: '海口',     lon: 110.3, dir: 'south' },
    hongkong:     { name: '香港',     lon: 114.2, dir: 'south' },
    macau:        { name: '澳门',     lon: 113.5, dir: 'south' },
    chongqing:    { name: '重庆',     lon: 106.5, dir: 'west' },
    chengdu:      { name: '成都',     lon: 104.1, dir: 'west' },
    guiyang:      { name: '贵阳',     lon: 106.6, dir: 'west' },
    kunming:      { name: '昆明',     lon: 102.7, dir: 'west' },
    lasa:         { name: '拉萨',     lon: 91.1,  dir: 'west' },
    xian:         { name: '西安',     lon: 108.9, dir: 'west' },
    lanzhou:      { name: '兰州',     lon: 103.8, dir: 'west' },
    xining:       { name: '西宁',     lon: 101.8, dir: 'west' },
    yinchuan:     { name: '银川',     lon: 106.2, dir: 'west' },
    urumqi:       { name: '乌鲁木齐', lon: 87.6,  dir: 'west' }
  };

  /* 方位五行映射：东方木、南方火、西方金、北方水、中央土 */
  var DIR_WUXING = {
    east: '木', south: '火', west: '金', north: '水', center: '土'
  };

  /* 方位中文标签（供结果页展示） */
  var DIR_LABEL = {
    east: '东方', south: '南方', west: '西方', north: '北方', center: '中原'
  };

  /* 血型能量倾向 */
  var BLOOD_TENDENCY = {
    A: { energy: 0.88, focus: 0.9 },
    B: { energy: 1.05, focus: 0.82 },
    AB: { energy: 0.98, focus: 1.1 },
    O: { energy: 1.12, focus: 0.92 }
  };

  /* MBTI 四维倾向：分别给出「稳健(stable)/进取(adventurous)/协作(social)/内省(inner)」修正量。
   * 注：adv / stable 数值逐字保留原值（computeFortune 评分只读取 adv，分数逻辑不变）；
   * social / inner 为「MBTI 人格视角」解读卡补全的展示用维度，不参与任何评分计算。 */
  var MBTI_MOD = {};
  var MBTI_TABLE = [
    ['INTJ', { adv: 0.8, stable: 0.2, social: 0.2, inner: 0.85 }], ['INTP', { adv: 0.6, stable: 0.5, social: 0.25, inner: 0.9 }],
    ['ENTJ', { adv: 0.9, stable: 0.15, social: 0.55, inner: 0.3 }], ['ENTP', { adv: 1.0, stable: 0.1, social: 0.6, inner: 0.35 }],
    ['INFJ', { adv: 0.4, stable: 0.7, social: 0.45, inner: 0.9 }], ['INFP', { adv: 0.5, stable: 0.6, social: 0.4, inner: 0.95 }],
    ['ENFJ', { adv: 0.5, stable: 0.55, social: 0.9, inner: 0.5 }], ['ENFP', { adv: 0.85, stable: 0.3, social: 0.85, inner: 0.45 }],
    ['ISTJ', { adv: 0.2, stable: 0.95, social: 0.3, inner: 0.45 }], ['ISFJ', { adv: 0.25, stable: 0.85, social: 0.6, inner: 0.55 }],
    ['ESTJ', { adv: 0.6, stable: 0.6, social: 0.65, inner: 0.25 }], ['ESFJ', { adv: 0.5, stable: 0.65, social: 0.95, inner: 0.35 }],
    ['ISTP', { adv: 0.7, stable: 0.5, social: 0.2, inner: 0.7 }], ['ISFP', { adv: 0.45, stable: 0.7, social: 0.5, inner: 0.75 }],
    ['ESTP', { adv: 0.95, stable: 0.25, social: 0.7, inner: 0.15 }], ['ESFP', { adv: 0.8, stable: 0.4, social: 0.9, inner: 0.25 }]
  ];
  MBTI_TABLE.forEach(function (row) { MBTI_MOD[row[0]] = row[1]; });

  /* MBTI 16 型中文俗称与关键词（仅用于「MBTI 人格视角」展示卡，纯静态文案，不参与评分） */
  var MBTI_PROFILE = {
    INTJ: { name: '建筑师',   keywords: ['战略脑', '独行侠', '高标准'] },
    INTP: { name: '逻辑学家', keywords: ['爱钻研', '脑洞大', '十万个为什么'] },
    ENTJ: { name: '指挥官',   keywords: ['目标感', '决断', '气场全开'] },
    ENTP: { name: '辩论家',   keywords: ['点子王', '反应快', '万物皆可辩'] },
    INFJ: { name: '提倡者',   keywords: ['外冷内热', '理想主义', '人间清醒'] },
    INFP: { name: '调停者',   keywords: ['理想主义', '共情', '内耗大师'] },
    ENFJ: { name: '主人公',   keywords: ['自来熟', '暖心', '气氛担当'] },
    ENFP: { name: '竞选者',   keywords: ['快乐小狗', '灵感喷泉', '三分钟热度'] },
    ISTJ: { name: '物流师',   keywords: ['靠谱', '讲规矩', '行走备忘录'] },
    ISFJ: { name: '守卫者',   keywords: ['细心', '老好人', '默默扛事'] },
    ESTJ: { name: '总经理',   keywords: ['执行力', '讲秩序', '人间打卡机'] },
    ESFJ: { name: '执政官',   keywords: ['热心肠', '社交粘合剂', '爱张罗'] },
    ISTP: { name: '鉴赏家',   keywords: ['冷幽默', '动手强', '话少但准'] },
    ISFP: { name: '探险家',   keywords: ['佛系', '审美在线', '随缘大师'] },
    ESTP: { name: '企业家',   keywords: ['行动派', '胆子大', '哪热闹去哪'] },
    ESFP: { name: '表演者',   keywords: ['人来疯', '开心果', '全场焦点'] }
  };

  /* 四维倾向中文标签（供展示「主导倾向」） */
  var MBTI_DIM_LABEL = { adv: '进取', stable: '稳健', social: '协作', inner: '内省' };

  /* 主导倾向 × 运势等级 的确定性建议文案（4 × 5 = 20 条，短句口语、可执行；直接映射，不耗 rng） */
  var MBTI_ADVICE = {
    adv: {
      'ji': '好风借力，今天可以大方加码，把想冲的事一次推到位。',
      'zhong-ji': '劲头在线但别贪多，锁定一两件最要紧的事往前拱。',
      'ping': '宜小步快跑不宜 all in，先试水、再加注，留好退路。',
      'xiong': '冲劲先收一收，今天硬冲容易撞南墙，缓两天再出手。',
      'da-xiong': '今日忌梭哈，想干的狠事先写下来，过了这阵再动。'
    },
    stable: {
      'ji': '稳中求进可加码，你稳得住，机会来了别只观望。',
      'zhong-ji': '按部就班就是最优解，把计划内的事做扎实就是赢。',
      'ping': '平常心守住基本盘，今天不出错、不折腾就是赚。',
      'xiong': '你的谨慎今天是护身符，没把握的事一律先按暂停。',
      'da-xiong': '全线防守，只做必须做的，其余全部往后搁。'
    },
    social: {
      'ji': '人缘正旺，多约多聊，贵人就藏在一次不起眼的闲聊里。',
      'zhong-ji': '找搭子一起推进，两个人合力远比单打独斗顺。',
      'ping': '少扎堆、少站队，社交电池省着点用，先顾好自己的事。',
      'xiong': '容易被别人的情绪带偏，重要的决定一定自己拿主意。',
      'da-xiong': '暂避人多口杂之地，先把自己的事理清再谈协作。'
    },
    inner: {
      'ji': '直觉在线，心里那个声音多半是对的，今天可以敢信自己一次。',
      'zhong-ji': '花十分钟把思路写下来，越写越清楚，越想越明白。',
      'ping': '别闷头空想，给思考设个截止时间，到点就动起来。',
      'xiong': '小心越想越丧，起身动一动，别让脑子一个人加班。',
      'da-xiong': '今日忌反复内耗，先睡一觉，明天再看这事就没那么大。'
    }
  };

  /* 各倾向的通用小贴士池（用独立 'mbti@' 种子确定性选取，与主 rng 序列完全隔离） */
  var MBTI_TIPS = {
    adv: ['把大目标拆成今天能做完的三小步', '灵感不等人，想到就先记下来', '冲的时候留一手退路，心里更踏实'],
    stable: ['睡前把明天的清单列好，稳上加稳', '重要文件多备份一份，安心加倍', '按自己的节奏走，别被人带乱拍'],
    social: ['给好久没联系的朋友发句问候', '开口求助不丢人，反而最省事', '群里多接一句话，气氛就不一样'],
    inner: ['留十分钟独处，把心里的账理一理', '写两行日记，给情绪一个出口', '少刷点手机，多听自己一点']
  };

  /* ======================== 三、核心推演函数 ======================== */

  /**
   * 由公历日期推算该日期的干支（六十甲子日）。
   * 基准：公历 1900-01-01 的天干地支为「甲戌日」（国内通用基准）。
   * 返回 { ganIndex, zhiIndex, ganChar, zhiChar }
   */
  function getDayGanzhi(year, month, day) {
    var base = new Date(1900, 0, 1); // 1900-01-01，甲戌日
    var target = new Date(year, month - 1, day);
    var diff = Math.round((target - base) / 86400000);
    // 甲戌日：天干甲=0，地支戌=10；六十甲子周期 60
    var gzIndex = ((diff % 60) + 60) % 60;
    // 推算：甲戌在天干循环里的日柱起点，需换算到更通用的索引公式
    // 简单做法：cnt 为自甲子日(天干0地支0)起算的天数
    // 甲戌对应编号 = 10（甲子=0，乙丑=1 ... 十个一组，甲戌在第二组第二位 => 10）
    var serial = ((10 + diff % 60) + 60) % 60;
    var ganIndex = serial % 10;
    var zhiIndex = serial % 12;
    return {
      ganIndex: ganIndex,
      zhiIndex: zhiIndex,
      ganChar: GAN[ganIndex],
      zhiChar: ZHI[zhiIndex],
      ganzhi: GAN[ganIndex] + ZHI[zhiIndex]
    };
  }

  /**
   * 生成某时间维度锚点字符串（保证同一维度同日/周/月/年产生相同种子）。
   * period: 'day'|'week'|'month'|'year'
   * refDate: 用于定位的目标日期（默认当天）
   */
  function anchorString(period, refDate) {
    var d = refDate ? new Date(refDate) : new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (period === 'day') {
      return 'D' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
    if (period === 'week') {
      // 取本周一的日期作为锚点
      var dow = (d.getDay() + 6) % 7; // 周一=0
      var monday = new Date(d);
      monday.setDate(d.getDate() - dow);
      return 'W' + monday.getFullYear() + '-' + (monday.getMonth() + 1) + '-' + monday.getDate();
    }
    if (period === 'month') {
      return 'M' + d.getFullYear() + '-' + (d.getMonth() + 1);
    }
    return 'Y' + d.getFullYear();
  }

  /**
   * 生成单个时间维度的运势结果。
   * @param {object} profile  解析后的个人资料
   * @param {string} period   'day'|'week'|'month'|'year'
   * @param {Date}   refDate  目标日期（默认当天）
   */
  function buildFortune(profile, period, refDate) {
    var d = refDate ? new Date(refDate) : new Date();

    /* ---- 1. 构造个人稳定种子（只要资料不变则恒定） ---- */
    var personalSeed = computePersonalSeed(profile);

    /* ---- 2. 叠加时间维度锚点 -> 最终种子 ---- */
    var periodStr = anchorString(period, d);
    var finalSeed = mixSeeds(personalSeed, hashString(periodStr));

    /* ---- 3. 创建可复现随机源 ---- */
    var rng = mulberry32(finalSeed);

    /* ---- 4. 综合基底评分（0-100），由多因子加权合成 ---- */
    var base = 50; // 及格线起点

    // 4.1 八字日干五行带来的基调：随机偏移但以年干支稳定锚定
    var hjIndex = (profile.birthKey && profile.dayGanIndex != null) ? profile.dayGanIndex : (personalSeed % 10);
    base += (hjIndex % 5) * 1.5; // [-3, +3] 左右

    // 4.2 六爻梅花卦数：由生日数字相加取卦，影响 ±6
    var guaSx = profile.moneyHex || Math.floor(rng() * 6);
    base += (guaSx - 2.5) * 1.2;

    // 4.3 当前时间维度自身的吉凶波动：随机但可复现 ±18
    base += (rng() * 2 - 1) * 18;

    // 4.4 五行与当下月相/五行生克：简化 —— 随机补充
    base += (rng() * 2 - 1) * 6;

    /* ---- 5. 资料修正（可选资料越多，置信度/微调越丰富） ---- */
    var notes = []; // 记录使用了哪些推演法，用于文案

    // 八字（只要生日，就有日干支）
    if (profile.dayGanzhi) {
      notes.push('八字');
      var sunFx = WUXING[profile.dayGanChar] || '土';
      if (sunFx === '火') base += 2;
      if (sunFx === '水') base += 1.5;
      if (sunFx === '金') base -= 1;
    }
    // 紫微（有出生时辰才计入，体现「命宫」加成）
    if (profile.hourProvided) {
      notes.push('紫微斗数');
      base += (rng() * 2 - 1) * 3;
    }
    // 星座
    if (profile.constellation) {
      notes.push('星座');
      var wd = STAR_WUXING[profile.constellation];
      if (wd === '火' || wd === '土') base += 2; else base += 0.5;
    }
    // 血型
    if (profile.blood && BLOOD_TENDENCY[profile.blood]) {
      notes.push('血型');
      base += (BLOOD_TENDENCY[profile.blood].energy - 1) * 6;
    }
    // MBTI
    if (profile.mbti && MBTI_MOD[profile.mbti]) {
      notes.push('MBTI');
      base += (MBTI_MOD[profile.mbti].adv - 0.5) * 4;
    }
    // 出生地方位五行（可选资料，未填则完全跳过，不影响既有结果）：
    // 东方木主生发、南方火主炎上、西方金主肃敛、北方水主智藏、中央土主厚载。
    // 表单时辰只到时辰粒度（2 小时），不做严格真太阳时校正，仅作小幅方位加成参考。
    var birthPlaceInfo = (profile.birthPlace && BIRTH_PLACES[profile.birthPlace]) || null;
    if (birthPlaceInfo) {
      notes.push('方位五行');
      var dirFx = DIR_WUXING[birthPlaceInfo.dir];
      if (dirFx === '木' || dirFx === '火') base += 2;        // 生发 / 炎上，劲头最足
      else if (dirFx === '水' || dirFx === '土') base += 1.5; // 智藏 / 厚载，稳健绵长
      else base += 1;                                          // 金主肃敛，收敛中求进
    }

    /* ---- 6. 越界钳制与取整 ---- */
    base = Math.max(8, Math.min(98, Math.round(base)));

    /* ---- 7. 评级 ---- */
    var levelKey, levelText;
    if (base >= 85)            { levelKey = 'ji';       levelText = '大吉'; }
    else if (base >= 70)       { levelKey = 'zhong-ji'; levelText = '吉'; }
    else if (base >= 50)       { levelKey = 'ping';     levelText = '平'; }
    else if (base >= 35)       { levelKey = 'xiong';    levelText = '凶'; }
    else                       { levelKey = 'da-xiong'; levelText = '大凶'; }

    /* ---- 8. 幸运色 / 幸运数字（种子稳定） ---- */
    var colors = ['朱砂红', '鎏金', '月白', '黛青', '绛紫', '玉脂白', '银灰', '松绿'];
    var luckyColor = pick(rng, colors);
    var luckyNumber = randInt(rng, 1, 9) * 10 + randInt(rng, 0, 9); // 两位数幸运数字
    if (luckyNumber < 10) luckyNumber += 10;

    /* ---- 9. 宜 / 忌 清单（依据评级与科目分布；文案偏口语化、带具体生活场景） ---- */
    var doPool = [
      '适合见朋友，约个茶聊聊天聚聚人气，说不定就听到好消息',
      '手头有想法就趁早落地，上午精力最足的时候推进最顺',
      '适合把家里或工位好好收拾一遍，换个窗明几净，心情也跟着顺',
      '适合读几页书、学点新东西，把脑子里那团迷雾拨开',
      '适合跟许久没联系的熟人重新打声招呼，一句问候可能带来机会',
      '该健身就健个身，出出汗，把这身的浊气都排出去',
      '适合把要紧的约、要紧的事排在前面，早办早省心，别推到后面',
      '吃顿对胃口、清淡点的饭，把状态养回来再谈别的',
      '拿不准的事多问一句，别一个人闷头瞎琢磨、硬扛着',
      '适合把拖了一阵的账结一结、把堆积的事清一清，清爽上路',
      '想见的人就去见，想说的话挑温和的时机说，别让机会溜走',
      '出门散步、晒晒太阳，给心情充充电，人的状态都不一样',
      '大事小事都拆小着做，一步一步来，别想着一口吃成胖子',
      '适合列张清单把今天安排得明明白白，做完一项划一项，心里踏实'
    ];
    var avoidPool = [
      '别急着做大的投资决定，先缓一缓，把账和风险都算清楚再说',
      '尽量别跟人抬杠顶牛，一时嘴上痛快，回头全是麻烦',
      '别熬夜，今天精力本来就一般，再熬就更亏了',
      '别轻信别人的口头担保和承诺，白纸黑字才算数',
      '别冲动下单、冲动消费，先丢进购物车凉一凉再决定',
      '别临时改约、放别人鸽子，信誉一旦坏了很难补回来',
      '别掐着点猛赶路、在路上慌张抢时间，安全永远是第一位',
      '别在气头上回消息、做决定，先让自己冷静十分钟',
      '别一股脑接太多活，贪多嚼不烂，到头来一团乱麻',
      '别把外面的情绪带到家、带到朋友身上，有话好好说',
      '别碰来历不明的钱和所谓的高收益机会，十有八九是套路',
      '别把自己绷得太紧，学会适当说“不”，硬撑最容易崩',
      '别在人多口杂的地方聊私事，隔墙有耳，惹来不必要的麻烦',
      '身体一旦报警就别硬扛，该歇就歇，别跟自己的命较劲'
    ];
    // 高评级 => 宜项多、忌项少；反之亦然
    var doCount, avoidCount;
    if (levelKey === 'ji' || levelKey === 'zhong-ji') { doCount = 4; avoidCount = 2; }
    else if (levelKey === 'ping')                     { doCount = 3; avoidCount = 3; }
    else                                              { doCount = 2; avoidCount = 4; }
    var dos = pickN(rng, doPool, doCount);
    var avo = pickN(rng, avoidPool, avoidCount);

    /* ---- 10. 领域提示（事业/财运/感情/健康/学业） ---- */
    var fields = [
      { key: 'career', icon: '💼', name: '事业' },
      { key: 'wealth', icon: '💰', name: '财运' },
      { key: 'love',   icon: '💞', name: '感情' },
      { key: 'health', icon: '🌿', name: '健康' },
      { key: 'study',  icon: '📚', name: '学业' }
    ];
    var fieldPanels = fields.map(function (f) {
      // 领域评分：在总分附近随机 ±10，且带该领域专属倾向
      var score = Math.max(10, Math.min(96, Math.round(base + (rng() * 2 - 1) * 12)));
      var fLevel = score >= 75 ? 'good' : score >= 45 ? 'middle' : 'bad';
      var tagTxt = fLevel === 'good' ? '佳' : fLevel === 'middle' ? '平' : '慎';
      var desc = pick(rng, fieldDescs[f.key]);
      return {
        icon: f.icon, name: f.name, score: score, level: fLevel, tag: tagTxt, desc: desc
      };
    });

    /* ---- 11. 总结文案（口语化话术池：依据等级从同一 rng 序列取一条，保持可复现） ---- */
    var sum =
      '这一' + (period === 'day' ? '天' : period === 'week' ? '周' : period === 'month' ? '月' : '年') +
      '整体走「' + levelText + '」（' + base + ' 分），' +
      '综合' + (notes.length ? notes.join('、') : '基础日柱') + '来看，我的建议是——' +
      pick(rng, sumPool[levelKey]);

    /* ---- 12. 组装结果对象 ---- */
    return {
      period: period,
      periodLabel: periodLabel(period, d),
      dateLabel: dateLabel(period, d),
      score: base,
      levelKey: levelKey,
      levelText: levelText,
      luckyColor: luckyColor,
      luckyNumber: luckyNumber,
      notes: notes,
      dos: dos,
      avo: avo,
      fields: fieldPanels,
      summary: sum,
      birthPlaceLabel: birthPlaceInfo
        ? birthPlaceInfo.name + '（' + DIR_LABEL[birthPlaceInfo.dir] + ' · ' + DIR_WUXING[birthPlaceInfo.dir] + '）'
        : '',
      ganzhi: profile.dayGanzhi || getDayGanzhi(d.getFullYear(), d.getMonth() + 1, d.getDate()).ganzhi
    };
  }

  /* 领域提示文案池（偏口语化、带具体生活场景，每领域多条由 rng 选取） */
  var fieldDescs = {
    career: [
      '今天事业上适合稳扎稳打，把手头的活做扎实，特别容易出成绩',
      '见领导、谈方案之前先把要点捋一遍，措辞想清楚，思路清晰最关键',
      '团队协作运不错，多跟同事商量着来，几个人合力比单打独斗强得多',
      '有变动、有调整的苗头也别慌，先看清楚再做判断，别急着表态站队',
      '适合把拖了好久的琐碎事一次处理干净，清空待办，做事才利索',
      '要紧的邮件、报表发出去之前多复核两遍，细节往往决定成败',
      '今天适合主动揽点能露脸的机会，让领导看见你的靠谱和担当'
    ],
    wealth: [
      '正财稳稳当当，该领的钱、该收的账都会踏实到位，别太心急',
      '今天不太适合大额资金进进出出，小打小闹可以，大事先让子弹飞一会',
      '花钱之前先问自己一句“真需要吗”，忍得住的冲动就是省下的钱',
      '有机会进一笔小账，欢迎之至，但也别指望一夜暴富、一步登天',
      '遇到推销和高收益“项目”多留个心眼，多数是挖好了坑等着你',
      '适合提前留出一笔应急钱，手有余粮，心里才不慌',
      '把账单好好理一理，哪些该停哪些该续，心里有数，花钱才不乱'
    ],
    love: [
      '跟另一半聊天别急着下结论，多听少说，感情往往就在这过程中升温',
      '单身的朋友今天适合主动一点，真诚地搭句话，桃花说不定就在转角',
      '相处里多退一步海阔天空，为了点鸡毛蒜皮置气最不值当',
      '多安排点一起做的事，一起做顿饭、散个步，比光是嘴上说都管用',
      '心里有烦心事就摊开说，别憋着，说开了反而更亲近更踏实',
      '别拿别人家另一半跟自己比，每个人的节奏都不一样，各自安好',
      '想约的人就约，别老是害羞往后缩，机会一错过就不是你的了'
    ],
    health: [
      '今天精力还行，但也别透支，睡够一觉比吃啥补品都实在',
      '久坐的朋友记得起身活动活动，肩膀和脖子是最容易受罪的',
      '换季了注意保暖、别贪凉，多喝温水，少碰冷饮和冰镇',
      '有心事别硬扛，找人好好聊一聊，情绪通了身体才通',
      '少吃油腻煎炸，把肠胃养舒服了，整个人状态都跟着不一样',
      '运动别一上来就猛，循序渐进、微微出汗就挺合适',
      '别把手机看到深夜，眼睛和睡眠这两样都得好好养'
    ],
    study: [
      '今天学习状态不错，趁注意力在线，把最难啃的章节先啃下来',
      '别贪多嚼不烂，先把今天那个小目标一个坑一个萝卜地做完',
      '遇到卡住、想不通的点就多请教，好记性不如先开口问一句',
      '适合换一个角度去学新东西，跨界的思路常能冒出意想不到的灵感',
      '复习时抓住重点和得分点，别在偏题怪题上死钻牛角尖',
      '给自己设一段短时专注的时间，集中火力，比连着磨洋工强',
      '今晚别熬夜背题，睡饱了大脑才记得牢，第二天事半功倍'
    ]
  };

  /* 整体运势总结话术池（口语化，按等级分档，多条由 rng 随机取一条；保持可复现） */
  var sumPool = {
    ji: [
      '今天这气运是真不错，尤其上午，想谈的事、想推进的活儿趁早动手，趁热打铁，多半顺顺利利，还能遇到帮得上忙的人。',
      '整体相当顺，走哪儿都有人乐意搭把手，别端着，该出手就出手，把握住这股劲。',
      '难得的好日子，精气神都在线，把要紧的事安排在前面，别拖到下午没劲了。',
      '气场杠杠的，出门办事一笑一个准，趁状态好，把重要的话、重要的事一次说清做透。',
      '这一阵你像是开了挂，干啥都有底气，正好把之前犹豫的事、拖着的事拿出来当场了断。'
    ],
    'zhong-ji': [
      '今天整体挺顺的，尤其是上午，想做的事趁早推进。别贪多，稳稳当当把眼前这步走扎实，后面自然就更顺。',
      '运势正在往上走，心里没底的事可以先探探路，见人说话客气些，机会多半就藏在聊天里。',
      '今天适合按部就班，把计划里能锁定的先锁定，不疾不徐反而出效果，一急躁就容易漏细节。',
      '整体偏顺，熟人的一句话可能帮上大忙，多走动走动，别窝在家里不动弹，人到事就到了。'
    ],
    ping: [
      '今天就是普普通通的一天，不凶不吉，稳稳当当来就行，不指望天上掉馅饼，也别瞎折腾，把手头的事一件一件做掉。',
      '运势平平，急不得，适合按部就班，别把日程排太满，给自己留点喘气的空当，情绪安稳最重要。',
      '今天没啥大风大浪，但小摩擦难免，话到嘴边先过一遍，能少说的少说，能避的小冲突尽量避开。',
      '整体中规中矩，适合理性想事、别冲动拍板，该花的钱、该办的事都按原计划走，别临时起意。'
    ],
    xiong: [
      '今天运势有点往下走，容易赶上些烦心事，事情也容易被搅黄，话少说、事缓办，别跟人硬顶，切记。',
      '今天不太顺，出门办事得多留个心眼，重要的决定先放一放，万一跟人起了争执，先退一步，事后再理。',
      '气运偏低，容易丢三落四、沟通踩雷，重要的证件、账号、约定都自查一遍，宁慢勿快。',
      '今天别逞强，情绪一上来先压一压，不适合做大的动作，把这一天安稳度过比啥都强，稳字当头。'
    ],
    'da-xiong': [
      '今天状态实在不佳，诸事容易受挫，最好别安排重要的事，能宅就宅、能歇就歇，把损失和口舌都挡在外面。',
      '诸事不宜的一天，冲动必定吃亏，大事一律往后放，跟人说话更得三思，一个不小心就容易闹僵。',
      '今天心气不顺、看啥都别扭，别在气头上做决定，也别去跟人掰扯，屏蔽掉烦心的事，好好睡一觉。',
      '今天多一事不如少一事，低调蛰伏为妙，该放下的纠缠就放下，养精蓄锐，等风头过去了再说。'
    ]
  };

  /* ======================== 三.五、「一事专断」推演分支（新增独立分支，不触碰整体 rng 序列） ======================== */

  /* 事项分类定义（含下拉项、图标、话术池键名） */
  var MATTER_CATEGORIES = [
    { key: 'career',  label: '工作/事业', icon: '💼' },
    { key: 'wealth',  label: '财运/投资', icon: '💰' },
    { key: 'love',    label: '感情/姻缘', icon: '💞' },
    { key: 'health',  label: '健康/出行', icon: '🌿' },
    { key: 'study',   label: '考试/学业', icon: '📚' },
    { key: 'deal',    label: '洽谈/合作', icon: '🤝' },
    { key: 'home',    label: '搬家/置业', icon: '🏡' },
    { key: 'other',   label: '其他',      icon: '✨' }
  ];

  /* 各分类 —— 依据 rng 选取的「宜做 / 忌做 / 总结」口语话术池（接地气、带具体场景，延续整体风格） */
  var matterPools = {
    career: {
      do: [
        '把简历和要谈的筹码提前捋清楚，心里有数了再出手才不会慌',
        '有靠谱的门路就勇敢去尝试，趁这股劲把能推进的部分先动起来',
        '跟对方把条件、时间线一条条问明白，白纸黑字最踏实',
        '现阶段的决定先求稳，选那条你更看得清结果的路径',
        '把笨功夫花在准备上，机会来的时候你才有底气接得住'
      ],
      avoid: [
        '别头脑一热就裸辞硬梭，先把手里的牌和退路都看清',
        '别在没搞清楚状况前就答应对方，吊着反而能看清真心',
        '别一个人闷头硬扛，该问的人多问两句不吃亏',
        '别把换工作这事想得太轻松，换个环境同样有新的坑要填',
        '别因为一时委屈就冲动拍板，冷静几天再回头看更清醒'
      ],
      sum: [
        '这事对你来说有得做，关键是别慌别急，把条件谈扎实了再签，稳中带进多半能成。',
        '整体不算太坏，机会是有的，就是得多留个心眼，别被眼前的甜头带跑偏。',
        '这次选择宜缓不宜急，多给自己留点复核和犹豫的空间，稳稳当当才是真赚。',
        '值得一试，但要把每一步都走扎实，尤其是白纸黑字的细节千万别含糊。'
      ]
    },
    wealth: {
      do: [
        '小额的可以先试试水，别一次就把家底全押上去，探探风向再说',
        '把每一笔收支都心里有数，账算清楚了才不容易被套路',
        '有靠谱的、看得懂的机会可以上，但只碰你输得起的钱',
        '手头有余钱就先留个应急底，财不入急门，稳住才有复利'
      ],
      avoid: [
        '别碰来路不明的“高收益”项目，越是拍胸脯保证的越要躲',
        '别跟风追热点，别人赚翻的时候往往就是你最容易接盘的时候',
        '别借钱去投资，也别把房贷车贷的生活钱砸进高风险里去博',
        '别轻信熟人安利的稳赚机会，亲兄弟也要把账和风险问清楚'
      ],
      sum: [
        '整体财运不算差，但求稳为主，能吃小肉就别贪大，踏实落袋才算真赚。',
        '这事有利有弊，适合细水长流地布局，急不得，一着急就容易踩到坑。',
        '平平稳稳为主，别指望一夜暴富，把风险控制好，稳中求进才是上策。',
        '可以适度投入，但一定要控制好仓位和风险，留足退路再进场不迟。'
      ]
    },
    love: {
      do: [
        '真诚一点，把心里话挑个轻松的时机慢慢说，比藏着掖着管用',
        '多安排点两个人一起做的事，一起做顿饭、散个步，感情就在这过程中升温',
        '遇到合适的人别害羞，大大方方地多聊几句，缘分往往就在一次主动里',
        '多从对方的角度想想，收一收自己的脾气，关系自然就更顺'
      ],
      avoid: [
        '别在气头上说狠话，一句伤人的话要好多天才能暖回来',
        '别拿别人家的感情标准来要求眼前人，各人的节奏不一样',
        '别为了迎合对方就丢了自己，好的关系是两个人都在舒服做自己',
        '别急着给对方贴标签、下结论，相处久了才知道合不合适'
      ],
      sum: [
        '这事有戏，但讲究个火候，别逼太急，顺其自然、真诚相处，多半能更进一步。',
        '整体偏顺，主动一点、真诚一点，机会往往就在你愿意迈出去的那一步里。',
        '宜缓不宜急，感情这事急不得，先把相处的基础打牢，水到渠成自然好。',
        '平平里带着一点转机，别患得患失，把当下这段关系经营好，剩下的交给时间。'
      ]
    },
    health: {
      do: [
        '把要出的远门安排在精力最好的时段，路况和天气都提前查清楚',
        '出行前给重要的证件、充电宝、备用药都打包好，有备无患',
        '路上多喝水、按时吃饭，累了就停下来歇歇，别硬撑赶路',
        '先去把身体的小毛病查清楚，养好了再谈别的更安心'
      ],
      avoid: [
        '别熬夜赶行程，睡眠和身体都经不起这么折腾',
        '别在疲劳的时候硬开长途、硬扛着继续，安全永远是第一位',
        '别贪嘴乱吃，肠胃不适应的时候，再好的局也得先放一放',
        '马虎的行程别安排太紧，留出缓冲，一着急就容易出岔子'
      ],
      sum: [
        '整体无大碍，但得把身体和行程都安排得从容些，稳扎稳打就顺顺当当。',
        '利大于弊，只要别大意，把安全细节想周全，这一趟基本能平安顺遂。',
        '平平和和，别跟自己较劲，该休息就休息，健康这块稳住了比啥都强。',
        '稍微留心一点就能避开小麻烦，宁慢勿快，照顾好自己最重要。'
      ]
    },
    study: {
      do: [
        '把要考的知识点抓大放小，先啃占分高的主干，别在偏题上钻牛角尖',
        '给自己设一段不受打扰的专注时间，集中火力比磨洋工强得多',
        '多总结错题，把反复错的点捋清楚，比盲目刷题提分快',
        '考前把节奏和心态都调稳，睡饱了才记得牢，第二天才发挥得出来'
      ],
      avoid: [
        '别临时抱佛脚搞通宵，睡眠不够，脑子转不动，白折腾',
        '别被同学间的进度和焦虑带跑，按自己的节奏来才算数',
        '别在考场上恋战一道没把握的题，该跳就跳，先保住能拿的分',
        '别把手机和杂念带上书桌，专注一进来，效率才上得去'
      ],
      sum: [
        '是个适合发力的好时候，认真准备、稳住心态，考出应有水平的机会很大。',
        '整体偏顺，功夫下在平时，考前把状态调稳，结果多半不负你。',
        '平平里求稳，脚踏实地地把该掌握的都掌握住，别抱侥幸心理就稳当。',
        '宜稳不宜急，这段时间适合扎实积累，急功近利反而容易出错。'
      ]
    },
    deal: {
      do: [
        '把目标和底线先写在纸上，谈判桌上才不至于被带偏',
        '说话给自己留点余地，条件谈不拢就改天再谈，别一口说死',
        '多听对方讲，把他的需求和顾虑摸透了，合作才谈得拢',
        '有合同就白纸黑字落下来，细节越清楚，后面纠纷越少'
      ],
      avoid: [
        '别当场冲动拍板，重要的合同先搁一夜，第二天再回味一下',
        '别把鸡蛋全放一个篮子里，多给自己留几条备选的路',
        '别在合作里只想着占便宜，吃亏讨好的便宜往往都埋着雷',
        '别信口开河的承诺，说到做到的才算数，其他的听听就好'
      ],
      sum: [
        '整体谈成的希望不小，关键是别操之过急，把条件谈瓷实了，合作才稳当。',
        '值得一谈，但要多留个心眼，把权责和利益都摆到台面上说清楚。',
        '宜缓不宜急，多谈两轮、多斟酌一下细节，成算会更大。',
        '平中带稳，别急着签，先把对方的诚意和风险都看明白再说。'
      ]
    },
    home: {
      do: [
        '重要证件、合同、收据都收好，白纸黑字的东西最怕丢',
        '搬家、置业多跑几趟实地看看，眼见为实，别只听中介一张嘴',
        '流程上的手续一步步走扎实，别嫌麻烦，省心在后面的日子',
        '把要顾的事项清单列出来，花钱和精力都花在刀刃上'
      ],
      avoid: [
        '别急着做大额产权决定，先多方比较、冷静几天再做主',
        '别在合同上省那点审阅的钱，风险和陷阱往往藏在小字里',
        '别贪便宜仓促定下，房子这事急不得，住进去再后悔就晚了',
        '别把所有积蓄一次性砸进去，留好应急的和周转的钱'
      ],
      sum: [
        '整体是桩可以踏实事的好事，稳扎稳打、流程走全，多半顺顺利利。',
        '利大于弊，适合推进，但该花的核查钱别省，细节里见真章。',
        '宜缓不宜急，把里里外外都看清楚了再落定，稳当才最省心。',
        '平中求稳，别被销售话术带跑，自己拿主意的几件事千万得看清楚。'
      ]
    },
    other: {
      do: [
        '把要做的事拆成小步，一步一步来，别让它压得你喘不过气',
        '拿不准的多问一句、多查一下，别一个人闷头瞎琢磨',
        '给自己留点余地和退路，计划赶不上变化，灵活一点更从容',
        '把要紧的几件先想清楚、排在前面，其它往后放放也无妨'
      ],
      avoid: [
        '别一时冲动就定大结论，先让自己冷静下来，事情往往没那么糟',
        '别在情绪上头的时候做决定，过夜再想，多半能看出不一样',
        '别把小事想得天塌下来，别让一件不顺手的事毁了整天的心情',
        '别抱着不切实际的期待，脚踏实地才不会太失望'
      ],
      sum: [
        '这事整体能办，但讲究个稳字，别急别燥，一步一步来多半能成。',
        '有把握就放手去做，遇到卡壳就先缓一缓、换个思路再进来。',
        '宜缓不宜急，先把能确定的确定下来，剩下的走一步看一步也踏实。',
        '平中带转机，冷静处之、量力而为，结果就不会太离谱。'
      ]
    }
  };

  /**
   * 「一事专断」推演：针对某一件具体事项，生成其在当前时间维度下的专属吉凶与建议。
   * 该方法是一条**完全独立**的推演分支：
   *   - 复用整体运势的个人种子 computePersonalSeed(profile)（同一个人、同一资料 → 同一个人基础）；
   *   - 事项种子 = mixSeeds(个人种子, hashString(事项文本+分类), hashString(时间维度锚点))，
   *     并用它 new 出**另一个独立的 mulberry32 rng**；
   *   - 因而这条分支的随机数消耗顺序与整体运势 buildFortune 的 rng 完全隔离，
   *     绝不改动既有整体运势的评分/等级/文案逻辑与既有 rng 次序，可复现性不受破坏。
   * @param {object} profile     解析后的个人资料
   * @param {string} matterText  用户具体事项文本（如"下周要不要跳槽"）
   * @param {string} categoryKey 事项分类键（career/wealth/.../other）
   * @param {string} period      'day'|'week'|'month'|'year'
   * @param {Date}   refDate     目标日期（默认当天）
   */
  function buildMatterFortune(profile, matterText, categoryKey, period, refDate) {
    var d = refDate ? new Date(refDate) : new Date();

    // 取分类话术池（兜底到 other）
    var pool = matterPools[categoryKey] || matterPools.other;

    // 1) 个人基础种子（与整体运势完全一致）
    var personalSeed = computePersonalSeed(profile);

    // 2) 事项稳定因子：事项文本 + 分类一起散列（同一事项、同一分类 → 同一事项因子）
    var matterKey = (matterText || '').trim() || (categoryKey || 'other');
    var matterFactor = hashString(matterKey + '@' + (categoryKey || 'other'));

    // 3) 叠加时间维度锚点 → 事项最终种子
    var periodStr = anchorString(period, d);
    var matterSeed = mixSeeds(personalSeed, matterFactor, hashString(periodStr));

    // 4) 独立 rng：这条分支的随机序列与整体运势 rng 完全隔离
    var rng = mulberry32(matterSeed);

    // 5) 事项专属评分（在整体基调附近波动，仍可复现）
    var score = Math.max(8, Math.min(98, Math.round(50 + (rng() * 2 - 1) * 24)));

    // 6) 专属评级（吉 / 平 / 凶 三档为主 + 大吉小凶）
    var levelKey, levelText;
    if (score >= 82)            { levelKey = 'ji';       levelText = '吉'; }
    else if (score >= 62)       { levelKey = 'zhong-ji'; levelText = '平偏吉'; }
    else if (score >= 42)       { levelKey = 'ping';     levelText = '平'; }
    else if (score >= 26)       { levelKey = 'xiong';    levelText = '凶'; }
    else                        { levelKey = 'da-xiong'; levelText = '凶险'; }

    // 7) 宜 / 忌 清单（每类各取若干条，由独立 rng 取样）
    var doCount = (levelKey === 'ji' || levelKey === 'zhong-ji') ? 3 : 2;
    var avoidCount = (levelKey === 'xiong' || levelKey === 'da-xiong') ? 3 : 2;
    var dos = pickN(rng, pool.do, Math.min(doCount, pool.do.length));
    var avo = pickN(rng, pool.avoid, Math.min(avoidCount, pool.avoid.length));

    // 8) 一句口语化总结（独立 rng 从分类总结池取样）
    var summary = pick(rng, pool.sum);

    // 9) 倾向性结论：依据评分给出"宜中带忌 / 宜大于忌 / 偏慎"等一句人话
    var tendency;
    if (score >= 70) {
      tendency = '此事可做，把握较大，趁着顺劲把要紧的推进去。';
    } else if (score >= 40) {
      tendency = '此事宜中带忌，可做但宜缓不宜急，把细节和退路都留足。';
    } else {
      tendency = '此事眼下不大顺，先放一放缓一缓，别在这个节骨眼硬上。';
    }

    // 10) 组装结果
    return {
      matterText: (matterText || '').trim(),
      categoryKey: categoryKey,
      categoryLabel: (MATTER_CATEGORIES.find(function (c) { return c.key === categoryKey; }) || { label: '其他' }).label,
      categoryIcon: (MATTER_CATEGORIES.find(function (c) { return c.key === categoryKey; }) || { icon: '✨' }).icon,
      score: score,
      levelKey: levelKey,
      levelText: levelText,
      dos: dos,
      avo: avo,
      summary: summary,
      tendency: tendency
    };
  }

  /** 依据分类键取中文标签（供只选分类未写文字时填充事项主体显示） */
  function categoryKeyLabel(key) {
    for (var i = 0; i < MATTER_CATEGORIES.length; i++) {
      if (MATTER_CATEGORIES[i].key === key) return MATTER_CATEGORIES[i].label;
    }
    return '这件事';
  }

  /* ======================== 三.七、「求签」与「答案之书」（新增娱乐分支，绝不触碰整体/一事 rng） ======================== */

  /* 签等级 -> 展示字样（沿用 level-pill 配色 class） */
  var LOTTERY_LEVEL = {
    'shang-shang': { label: '上上签', cls: 'ji' },
    'shang':       { label: '上吉',   cls: 'zhong-ji' },
    'zhong-ji':    { label: '中吉',   cls: 'ping' },
    'zhong-ping':  { label: '中平',   cls: 'ping' },
    'xia-xia':     { label: '下下签', cls: 'da-xiong' }
  };

  /**
   * 签支数据表（一支签 = 一个元素）：
   *   title     四/二字古典签题（如「鸿鹄得志」「蟾宫折桂」），各签互不重复
   *   level     签等级键（shang-shang / shang / zhong-ji / zhong-ping / xia-xia）
   *   poem      古典签诗，7 言 4 句为主，典雅庄重、融入传统意象
   *   interpret 「签文解析」对象，对标寺庙灵签「解签」板块，覆盖 8 项：
   *              家宅 / 求财 / 婚姻 / 功名 / 健康 / 失物 / 行人 / 诉讼
   *   advice    1-2 句白话解签（「白话点睛」，帮助理解）
   * 注：签的「号数」由在表中的位置决定（第 N 签），抽签只决定命中哪一支。
   */
  var LOTTERY_SIGNS = [
    {
      title: '鸿鹄得志', level: 'shang-shang',
      poem: ['龙腾凤鸣天开张', '万里鹏程在此方', '莫待东风空自费', '一朝雨足遍地香'],
      interpret: { home: '家宅兴旺，人丁和睦，宜修整宅院以求安泰', wealth: '财源广进，正偏财皆旺，宜顺势进取', marriage: '姻缘和合，良缘已在眼前，宜早定佳期', career: '功名显达，大器晚成终有扬眉之时', health: '身心康泰，气脉顺畅，无灾无病', lost: '失物有望，向阳寻之，不日可得', travel: '行人有喜，归期不远，一路平安', lawsuit: '冤怨两消，理直则胜，宜以和了之' },
      advice: '此为上上大吉，运势如日中天，把所有要紧的事趁这股旺气推进，多半水到渠成。'
    },
    {
      title: '蟾宫折桂', level: 'shang-shang',
      poem: ['金阙云梯步步高', '蟾宫桂子月中飘', '寒光磨尽青云路', '一举登科意气骄'],
      interpret: { home: '家运隆昌，长辈安康，宜添祥增福', wealth: '财如春潮，滚滚而至，稳中有升', marriage: '门当户对，红鸾星动，姻缘大吉', career: '功名高中，事业冲顶，宜奋力一搏', health: '体健神清，元气充盈，安然无恙', lost: '失物在宅，仔细寻之，贵不难还', travel: '出行大吉，贵人相随，名利双收', lawsuit: '理在我方，得高人助，无往不利' },
      advice: '蟾宫折桂，功名有望。心中所求，只管奋力去取，必能一举高中。'
    },
    {
      title: '祥云捧日', level: 'shang-shang',
      poem: ['一片祥云捧日轮', '光天化日庆新春', '云开雾散千山朗', '随处耕锄总是春'],
      interpret: { home: '家宅光辉，门庭瑞气，宜纳福修德', wealth: '财如日照，光辉四射，宜乘势而进', marriage: '良缘天成，婚嫁皆宜，两情相悦', career: '前程似锦，青云直上，指日高升', health: '精神爽朗，百病不侵，身心俱泰', lost: '失物不没，宜往高处寻，可望寻回', travel: '行路平安，逢凶化吉，一路顺风', lawsuit: '福星高照，逢讼多利，宜和不宜强' },
      advice: '祥云捧日，光明在望。一切晦暗皆散，只管朝光明处前行。'
    },
    {
      title: '龙归沧海', level: 'shang-shang',
      poem: ['沧海龙归入深渊', '风云际会自翩翩', '潜鳞暂屈非终困', '一遇惊雷跃九天'],
      interpret: { home: '家业宽宏，根基稳固，宜积善余庆', wealth: '财源浩荡，如归沧海，蓄而后发', marriage: '姻缘深厚，两情相得，珠联璧合', career: '怀才待时，风云际会，终有大用', health: '气血和畅，龙马精神，老当益壮', lost: '失物难觅，如龙入海，渺渺难寻', travel: '远行有得，如鱼得水，所向顺遂', lawsuit: '势如破竹，得理而胜，不必忧虑' },
      advice: '龙归沧海，暂藏锋芒。眼前或需蓄力忍耐，但大势终起，吾辈岂是池中物。'
    },
    {
      title: '丹凤朝阳', level: 'shang',
      poem: ['丹凤翩翩下玉京', '九霄云外报天晴', '阳和启蛰花千树', '百鸟朝鸣贺太平'],
      interpret: { home: '家宅安宁，喜气盈门，宜张灯结彩', wealth: '财利丰盈，如丹凤朝阳，蒸蒸日上', marriage: '姻缘和美，喜气临门，宜早成礼', career: '功名起色，事业中兴，渐入佳境', health: '四时安和，旧疾渐愈，日渐康健', lost: '失物向明处寻，日光照处可得', travel: '出行如意，逢喜逢和，百无禁忌', lawsuit: '争端将解，和气了之，化干戈为玉帛' },
      advice: '丹凤朝阳，中吉之象。所求之事渐有喜色，宜趁阳气正盛之时推进。'
    },
    {
      title: '锦鳞游泳', level: 'shang',
      poem: ['锦鳞游泳戏清波', '一路顺风到海河', '好景怡情宜趁早', '前程远大莫蹉跎'],
      interpret: { home: '家运平顺，春风和畅，宜持家和谐', wealth: '财如流水，绵绵不断，宜细水长流', marriage: '姻缘顺遂，相敬如宾，渐入佳境', career: '事业顺遂，如鱼得水，稳步向前', health: '体健身轻，精气常足，安然无恙', lost: '失物随水，宜寻于低处溪边', travel: '行程顺利，如锦鳞游泳，行无阻滞', lawsuit: '纠纷渐解，得人排解，宜多为和' },
      advice: '锦鳞游泳，顺顺当当。眼下诸事都在正确的轨道上，别被小事打乱节奏。'
    },
    {
      title: '春风得意', level: 'shang',
      poem: ['春风得意马蹄疾', '一日看尽长安花', '贵人喜气临门至', '福泽绵延到万家'],
      interpret: { home: '家宅和乐，一派春色，宜团聚庆喜', wealth: '财星高照，进账不断，宜积极进取', marriage: '姻缘得意，两情相悦，花好月圆', career: '仕途得意，官运亨通，乘风破浪', health: '春回气畅，周身舒泰，百邪不侵', lost: '失物得意，往喜庆处寻可复得', travel: '出行得意，春风拂面，一路顺利', lawsuit: '理直气壮，得胜无碍，宜从容对之' },
      advice: '春风得意，正是看尽长安花的好时节。趁此气势，把大事一举推进。'
    },
    {
      title: '瑞雪丰年', level: 'shang',
      poem: ['瑞雪纷纷兆丰年', '琼枝玉叶满山川', '五谷登仓仓廪实', '一家和气乐陶然'],
      interpret: { home: '家宅丰盈，仓廪俱实，宜积谷防饥', wealth: '财聚如山，瑞气盈门，宜守中带进', marriage: '姻缘和顺，白首同心，宜结百年之好', career: '功名有成，积厚流芳，渐入佳境', health: '四时安泰，体魄康健，无寒无病', lost: '失物在宅，藏之高阁，细查可寻', travel: '出行得宜，风雪无碍，平安往返', lawsuit: '讼事将平，得人调停，宜和为贵' },
      advice: '瑞雪兆丰年，中吉安稳。这是厚积薄发的时节，把根基扎实了，福气自来。'
    },
    {
      title: '月映江心', level: 'shang',
      poem: ['月映江心水面清', '澄明一片照人行', '莫嫌此夜行舟慢', '自有云开雾散时'],
      interpret: { home: '家宅清静，明净安然，宜修心养静', wealth: '财路清朗，不急不躁，宜稳步累积', marriage: '姻缘澄明，情意映照，宜坦诚以待', career: '事业澄澈，云开见月，渐入正轨', health: '心清体泰，虑静神安，无有挂碍', lost: '失物映水，宜近水处寻，可望寻回', travel: '行舟虽慢，方向清明，终能抵达', lawsuit: '是非清朗，理自昭然，宜静观其变' },
      advice: '月映江心，中吉之中带一分明亮。眼下虽未至尽头，但方向已明，静候云开。'
    },
    {
      title: '金榜题名', level: 'shang',
      poem: ['金榜高悬耀日明', '十年窗下苦功成', '一朝得遂凌云志', '万里鹏程任我行'],
      interpret: { home: '家运昌隆，门楣生辉，宜勉励后人', wealth: '财凭功名而进，宜以才立业', marriage: '姻缘可期，郎才女貌，宜早定盟', career: '功名成就，一举成名，名利双收', health: '身心俱健，神采飞扬，康泰无恙', lost: '失物有望，得名而得，费心可寻', travel: '出行得利，贵人扶持，前程万里', lawsuit: '理直而得胜，如金榜题名，无须忧' },
      advice: '金榜题名，功成名就。这是扬眉吐气的好签，只管大步向前。'
    },
    {
      title: '梅开二度', level: 'zhong-ji',
      poem: ['雪里梅花二度开', '寒香依旧报春来', '前番忧绪随风去', '花落花开又一回'],
      interpret: { home: '家中虽有反复，终归和乐，宜多谅', wealth: '财运一度起伏再起，宜沉稳再布局', marriage: '姻缘前冷后热，几度回环终能如愿', career: '事业柳暗花明，几番波折再上层楼', health: '旧疾见愈，时暖时寒宜加调理', lost: '失物一度再遇，念念不忘或有回响', travel: '行期反覆，出行延迟但终成行', lawsuit: '讼事反覆，宜耐心周旋，终能化解' },
      advice: '梅开二度，中吉偏稳。好事曾遭折返，但只要不放弃，终会再度开花。'
    },
    {
      title: '景星庆云', level: 'zhong-ji',
      poem: ['景星灿烂庆云明', '俯首人间送太平', '但得心平气自顺', '何须向外觅前程'],
      interpret: { home: '家宅平顺，瑞气潜藏，宜安守近乐', wealth: '财路平正，不期暴富，宜踏实行事', marriage: '姻缘平稳，情意绵绵，宜慢慢经营', career: '前程可望，不急不躁，稳中有进', health: '身心和畅，安然自若，无大恙', lost: '失物有望，宜耐心寻之，不可急躁', travel: '出行平和，虽无大惊喜，亦无大碍', lawsuit: '讼事平和，易得调解，宜息事宁人' },
      advice: '景星庆云，中吉平和。不求速成，但求心安，福气自会慢慢聚拢。'
    },
    {
      title: '枯木逢春', level: 'zhong-ji',
      poem: ['枯木逢春发新枝', '残云散尽见晴曦', '寒灰垂尽犹生火', '绝处逢生定可期'],
      interpret: { home: '家运由衰转盛，枯木逢春，宜提振', wealth: '财运绝处逢生，宜敢破敢立', marriage: '姻缘柳暗花明，已冷之情或再回温', career: '事业转机在望，柳暗花明又一村', health: '沉疴渐愈，生机重焕，宜加调理', lost: '失物若弃则归难，若恒心或复得', travel: '前路逢春，一路转而顺，终能达', lawsuit: '绝处逢生，纠纷峰回路转而得解' },
      advice: '枯木逢春，中吉带转机。眼下虽至谷底，但只要不放弃，生机就在转角。'
    },
    {
      title: '和风细雨', level: 'zhong-ji',
      poem: ['和风细雨润青苗', '万物逢时各自娇', '切莫急功求速效', '静养深根自可饶'],
      interpret: { home: '家宅温和，细雨润物，宜厚养亲情', wealth: '财如细雨，涓滴成河，宜长期累积', marriage: '姻缘柔顺，细水长流，宜渐养情深', career: '事业缓进，深根厚植，水到渠成', health: '气血和缓，润物无声，宜静养调和', lost: '失物宜细寻于寻常处，可缓缓归', travel: '行程和顺，无惊无险，一路平安', lawsuit: '讼宜缓办，以柔克刚，宜和为上' },
      advice: '和风细雨，中吉稳妥。运气不疾不徐，宜学春雨润物般耐心经营。'
    },
    {
      title: '旭日初升', level: 'zhong-ji',
      poem: ['旭日初升照晓天', '霞光万丈紫云编', '前程正自今朝始', '稳步乘风步步前'],
      interpret: { home: '家运初兴，气象一新，宜图奋发', wealth: '财运方兴，如日初升，宜循序而进', marriage: '姻缘初萌，晨曦可期，宜待其成', career: '事业方兴未艾，新程伊始，宜勤耕', health: '体气渐充，精神日旺，愈养愈健', lost: '失物初现端倪，宜趁晨光觅之', travel: '出行方始，蒸蒸日上，宜启程', lawsuit: '讼事初解，明理在前，宜从容处之' },
      advice: '旭日初升，中吉向好。新的篇章才刚刚翻开，早起多劳，自有所获。'
    },
    {
      title: '花好月圆', level: 'zhong-ji',
      poem: ['花好月圆喜气盈', '两情和合梦同成', '好事多磨终遂愿', '细水长流共此生'],
      interpret: { home: '家宅团圆和美，宜多聚多庆', wealth: '财喜双全，圆圆满满，宜储宜守', marriage: '姻缘和美，花好月圆，宜成佳偶', career: '事业顺遂圆满，宜守成继进', health: '身心俱佳，福泽绵长，安然无恙', lost: '失物团圆，宜检日常所用之处', travel: '行期圆满，一路顺遂，早日归家', lawsuit: '讼事圆满，和好收场，宜息争' },
      advice: '花好月圆，中吉和美。圆满之事正在成形，惟需耐心守候，美好自会如愿。'
    },
    {
      title: '平步青云', level: 'zhong-ji',
      poem: ['平步青云不须梯', '春风吹送入云霓', '但存正直无私心', '自有天公作护持'],
      interpret: { home: '家运平正，老少皆宜，宜守清持正', wealth: '财路平正，青云直上，宜脚踏实地', marriage: '姻缘端正，门风相契，宜守礼成婚', career: '事业平顺，渐入云端，宜正身从业', health: '体气平正，起居有时，身安康泰', lost: '失物平实处寻，脚踏实地或可得', travel: '出行平顺，青云相送，一路安和', lawsuit: '持正则胜，光明磊落，无须苟且' },
      advice: '平步青云，中吉。此签重在一个「正」字，只要行事端方，青云自可步上。'
    },
    {
      title: '松柏长青', level: 'zhong-ji',
      poem: ['岁寒松柏自长青', '历尽霜雪更青青', '坚贞自有神明佑', '留得根深庇后生'],
      interpret: { home: '家基深厚，如松柏长青，宜守根本', wealth: '财源稳健，历久弥坚，宜守长线', marriage: '姻缘坚贞，历久弥笃，宜守初心', career: '事业持久，以恒而成，宜坚持不懈', health: '体魄强健，如松不老，宜多动养身', lost: '失物难寻，如叶落林间，恐难复得', travel: '远行有阻，坚忍而行，终能平安', lawsuit: '讼事绵长，以坚忍对之，终得结果' },
      advice: '松柏长青，中吉。此签重在「坚持」二字，岁月虽长，坚者自胜。'
    },
    {
      title: '山高水长', level: 'zhong-ji',
      poem: ['山高自有云来绕', '水阔长流到海潮', '但守本心清净志', '浮名浮利任逍遥'],
      interpret: { home: '家业绵长，如山水相映，宜守安宁', wealth: '财源长远，不期速至，宜从容聚财', marriage: '姻缘长远，细水长流，宜相守以诚', career: '事业远大，非一日之功，宜循序渐进', health: '体魄如山水绵长，宜动静相宜', lost: '失物随山水远，恐难寻，宜作别', travel: '远行水远山长，宜备足行程耐心', lawsuit: '讼延日久，宜旷达处之，莫执念' },
      advice: '山高水长，中吉。眼前不求速成，放眼长远，从容之心最养福。'
    },
    {
      title: '春风化雨', level: 'zhong-ji',
      poem: ['春风化雨润枯田', '桃李无言自成妍', '平生种得善因好', '自有天心报眼前'],
      interpret: { home: '家宅和润，化雨泽物，宜广积善缘', wealth: '财路润泽，但求无贪，徐徐积累', marriage: '姻缘化雨，润物无声，宜和气相处', career: '事业以德成，春风化雨，水到渠成', health: '体气和畅，如沐春风，安然无病', lost: '失物润泽处寻，或已易主，难复得', travel: '行路和润，逢春生草，一路顺遂', lawsuit: '以德解怨，化雨息争，宜劝和' },
      advice: '春风化雨，中吉。此签劝人心存善念、以德待人，福德自会偿还。'
    },
    {
      title: '云开见日', level: 'zhong-ji',
      poem: ['云开雾散见天晴', '日照山川草木明', '前路迷茫今已辨', '坦然迈步向前行'],
      interpret: { home: '家宅晦气渐散，重见光明，宜欢庆', wealth: '财运拨云见日，转机立现，宜把握', marriage: '姻缘云开月现，疑虑尽消，宜交心', career: '事业迷雾散尽，方向已明，宜大行', health: '诸恙渐愈，若云开见日，日渐康健', lost: '失物云开可寻，暗中藏光，仔细找', travel: '出行放晴，通达无碍，宜早日启程', lawsuit: '是非澄清，云开见日，理昭自明' },
      advice: '云开见日，中吉。沉已久的天终于放晴，方向既明，尽管大步往前。'
    },
    {
      title: '流水高山', level: 'zhong-ping',
      poem: ['高山流水觅知音', '冷落琴心独自吟', '世路茫茫知者少', '宜将真意付知心'],
      interpret: { home: '家宅清净，知音难觅，宜静守本分', wealth: '财运平淡，知者方得，宜守正待时', marriage: '姻缘可期，宜觅知心之人，莫将就', career: '事业须待伯乐，怀才莫躁，宜自修', health: '身心宁静，宜陶养性情，远离烦扰', lost: '失物多难寻，宜问知心人所见', travel: '行旅寂寥，宜结伴而行，勿独行远', lawsuit: '讼难得助，知音者劝，宜和为要' },
      advice: '流水高山，中平。此签重「知音」，眼前虽有寂寥，但真意终会被识得，不必强求。'
    },
    {
      title: '守正待时', level: 'zhong-ping',
      poem: ['天时人事两相催', '守正何须问卦裁', '但把本心常自守', '云开早晚自登台'],
      interpret: { home: '家宅宜守常安分，不急不躁', wealth: '财运宜守正，不可妄动，待时而发', marriage: '姻缘宜待，正心诚意，好事多磨', career: '事业守正，静候时机，终有大用', health: '体气以养为本，守正则邪不侵', lost: '失物待时，宜守常处，日久或现', travel: '出行宜缓，时不我至，待机而动', lawsuit: '讼宜守正，静待公断，不可先动' },
      advice: '守正待时，中平。时事未到急不来，守住正道与分寸，静候即可。'
    },
    {
      title: '推车过岭', level: 'zhong-ping',
      poem: ['推车过岭路途艰', '步步艰难步步艰', '莫怨途中多险阻', '越过重山即是山'],
      interpret: { home: '居家劳碌，须齐心共渡，渐渐安泰', wealth: '财路艰难，积少成多，宜省吃俭用', marriage: '姻缘有阻，患难与共，终能相守', career: '事业有阻，艰辛在前，坚持方成', health: '体气疲惫，宜量力而行，莫过劳', lost: '失物难寻，劳心费力，恐难复得', travel: '行路多阻，宜备足盘缠耐心而进', lawsuit: '讼途艰难，宜寻人调解，莫硬扛' },
      advice: '推车过岭，中平偏辛。前路有坡有坎，别指望一步登天，推一步是一步。'
    },
    {
      title: '雪中送炭', level: 'zhong-ping',
      poem: ['雪中送炭济寒人', '一点温情暖及身', '莫笑当时行善浅', '他年自报涌泉恩'],
      interpret: { home: '家得人助，雪中送炭，宜感恩图报', wealth: '财运逆境得援，宜铭记恩义勿忘', marriage: '姻缘患难相扶，真情现于急难', career: '事业窘迫得人提携，宜知恩奋进', health: '体弱得人照料，宜保重调养', lost: '失物断而复续，得人助寻可复得', travel: '行旅困乏得人周济，宜善待人', lawsuit: '讼中得人襄助，终能雪中见晴' },
      advice: '雪中送炭，中平而暖心。正当困顿时得有真情相援，这份善缘值得牢记。'
    },
    {
      title: '磨杵成针', level: 'zhong-ping',
      poem: ['铁杵研磨岁月长', '功夫到处自成钢', '莫讥此计太迟缓', '一日功深百世光'],
      interpret: { home: '家道中正，积年而成，宜抱恒心', wealth: '财运以勤成，少而积累，终成其富', marriage: '姻缘久磨，精诚所至，金石为开', career: '事业久久为功，不宜速效，宜笃行', health: '体气以养，日久见功，宜贵在坚持', lost: '失物日久或现，勤于检寻，或得之', travel: '行期虽缓，终能抵达，宜耐心以行', lawsuit: '讼事绵长，坚持自胜，宜守勿躁' },
      advice: '磨杵成针，中平。此签最忌性急，多一份耐心，你的坚持终会磨出锋芒。'
    },
    {
      title: '三阳开泰', level: 'zhong-ping',
      poem: ['三阳开泰转乾坤', '否极还须泰自存', '阳气初回宜养静', '春雷一动满天新'],
      interpret: { home: '家运转泰，春回大地，宜纳新除旧', wealth: '财运初开，尚需养势，宜循序而进', marriage: '姻缘转暖，慢慢回春，宜相待以诚', career: '事业否极泰来，转机已现，宜把握', health: '体气如春回冻土，渐愈宜养', lost: '失物当春而生，宜往向阳处寻', travel: '出行逢泰，路转峰回，日渐顺遂', lawsuit: '讼逢转机，否极泰来，终得两平' },
      advice: '三阳开泰，中平转吉。扭转之机正在萌芽，顺应春气，静待万物生发。'
    },
    {
      title: '竹报平安', level: 'zhong-ping',
      poem: ['清影琅玕节节高', '平安二字月中飘', '报得家山无别事', '清风明月两逍遥'],
      interpret: { home: '家宅平安，节节高升，宜安守清福', wealth: '财路平稳，不求速发，宜守节自律', marriage: '姻缘平安顺和，宜长相厮守', career: '事业平实稳妥，心安即是福', health: '体魄安和，如竹常青，宜注意起居', lost: '失物难寻，如竹影飘风，恐难挽回', travel: '行程平安，途中虽有风，终归无事', lawsuit: '讼事平安，风波不兴，宜息事' },
      advice: '竹报平安，中平。这一签把「平安」二字看得最重，安稳健康便是最大的福。'
    },
    {
      title: '静待时机', level: 'zhong-ping',
      poem: ['潜龙勿用养其真', '未到风云暂屈身', '静待春雷惊蛰起', '腾云变化自惊人'],
      interpret: { home: '家宅宜静养，莫兴波澜，安安稳稳', wealth: '财宜潜蓄，不宜妄动，待机而出', marriage: '姻缘徐徐，莫急相亲，静候良辰', career: '事业潜修，未到出手时宜蓄力', health: '体气宜静养，休养生息，莫强耗', lost: '失物未现，静待时日，或偶得之', travel: '出行非时，宜静勿动，缓图之', lawsuit: '讼不宜急，静待机会，从容应对' },
      advice: '静待时机，中平。时机未到，硬动反易生乱，潜龙勿用，静候惊蛰。'
    },
    {
      title: '雾里看花', level: 'zhong-ping',
      poem: ['雾里看花看不真', '是非真假两茫茫', '劝君且莫轻下语', '待到云开见本真'],
      interpret: { home: '家事蒙雾，真伪难辨，宜静观莫断', wealth: '财运扑朔，虚实难测，忌贪勿动', marriage: '姻缘迷离，真假难分，宜多观望', career: '事业雾障，方向不明，宜慎行缓进', health: '旧症缠绵难清，宜查其本源', lost: '失物雾中难见，恐沉沦难寻', travel: '行路迷濛，宜暂缓行，待晴而动', lawsuit: '讼情难辨，莫妄论断，宜求明辨是非' },
      advice: '雾里看花，中平。当真相扑朔迷离时，最忌贸然下注，且等这层雾散去。'
    },
    {
      title: '逆水行舟', level: 'zhong-ping',
      poem: ['逆水行舟费气力', '不进则退语堪惊', '一篙松处千寻落', '勉力撑持莫暂停'],
      interpret: { home: '家道中流，宜奋力持守，不进则退', wealth: '财运吃紧，如逆水行舟，宜勤俭', marriage: '姻缘费力，多劳少逸，宜用心经营', career: '事业受阻，不进则退，宜加倍用心', health: '体气偏弱，宜多劳动多养息', lost: '失物逆水难复，恐一去难寻', travel: '行路艰阻，浪高水急，宜倍加小心', lawsuit: '讼事艰难，如逆水行舟，宜谨慎周旋' },
      advice: '逆水行舟，中平偏累。前路有阻力，一松手便前功尽弃，咬紧牙关别停。'
    },
    {
      title: '拨云见月', level: 'zhong-ping',
      poem: ['云浓深处月难明', '拨尽层阴见玉庭', '历遍艰难方得见', '澄澄心里自常明'],
      interpret: { home: '家宅渐见清朗，拨开阴翳，宜宽心', wealth: '财路历难而通，宜拨冗整理账目', marriage: '姻缘历久见真情，拨云便见月', career: '事业守得云开，拨尽层阴见日', health: '沉疴将愈，拨开郁结，身心俱明', lost: '失物拨寻，宜往藏光处细觅', travel: '行程历险而安，云开自见归途', lawsuit: '讼情拨云见月，是非终得明白' },
      advice: '拨云见月，中平而终明。眼前的阴霾终会散去，且多一分坚持，便多一分光明。'
    },
    {
      title: '平地风波', level: 'zhong-ping',
      poem: ['平地无端起风波', '横生是非乱云罗', '劝君遇事权宽忍', '退步由来福气多'],
      interpret: { home: '家中恐起无端口舌，宜宽忍息事', wealth: '财运忽有波折，宜暂避锋芒守钱', marriage: '姻缘平添波澜，宜冷静勿起争执', career: '事业遭遇无端是非，宜守正方稳', health: '身心偶有小恙，宜调息静养', lost: '失物因乱而失，宜仔细回顾旧迹', travel: '出行恐逢波折，宜留意水边路险', lawsuit: '讼起平地，无端遭是，宜以忍化解' },
      advice: '平地风波，中平偏仄。忽然而起的是非最难防，最好的办法是退让宽忍。'
    },
    {
      title: '画饼充饥', level: 'xia-xia',
      poem: ['画中饼饵岂能充', '纸上功名总成空', '莫仗虚名空自傲', '脚踏实地始为功'],
      interpret: { home: '家计空虚，务虚难实，宜省俭务实', wealth: '财不过纸面，徒有虚名，忌投机', marriage: '姻缘无实，镜花水月，宜看清现实', career: '事业有名无实，忌纸上谈兵', health: '体虚空耗，宜实补真养，忌空谈', lost: '失物如画饼，虚无缥缈，恐难复得', travel: '出行图虚，光景如梦，宜务实而行', lawsuit: '讼以虚应，难收实果，宜务实求理' },
      advice: '画饼充饥，下下。华而不实的虚妄终不能长久，能靠的只有脚踏实地。'
    },
    {
      title: '明珠暗投', level: 'xia-xia',
      poem: ['明珠无眼暗中投', '误向泥涂不自求', '宝器还须真主识', '错教遗恨在心头'],
      interpret: { home: '家有宝器，乏人赏识，宜善藏勿轻售', wealth: '财被埋没，所托非人，忌轻信人', marriage: '姻缘所托非人，明珠暗投，宜收心', career: '才华不遇，鱼目混珠，宜慎择环境', health: '体气暗损，宜察微知著早调养', lost: '失物暗投，如珠入泥，恐难复见', travel: '出行所投非地，宜择明处而行', lawsuit: '讼仇暗投，防人之心，宜谨防备' },
      advice: '明珠暗投，下下。价值错付给了不懂珍惜的对象，及时收回来才是止损。'
    },
    {
      title: '临渊慕鱼', level: 'xia-xia',
      poem: ['渊深不见鱼游处', '只在高处慕长叹', '不若结网勤磨手', '得来自在欢喜满'],
      interpret: { home: '家计空想，不如实做，宜戒空谈', wealth: '财不可望渊息叹，宜结网务实做', marriage: '姻缘只慕难成，不如主动经营', career: '事业空羡慕人，宜脚踏实地自求', health: '体气故志高远，宜实练实养', lost: '失物在渊，虽见难取，恐费力难成', travel: '出行难成，空望美景，宜备实功', lawsuit: '讼只观望不实办，难有实利' },
      advice: '临渊慕鱼，下下。光看着鱼跃却不动手，永远吃不到鱼，退而结网才是正途。'
    },
    {
      title: '坐失先机', level: 'xia-xia',
      poem: ['时来运转乘东风', '一霎蹉跎万事空', '莫待花残空怅望', '应知紧手握匆匆'],
      interpret: { home: '居家慵懒，坐失良机，宜振作处事', wealth: '财运因迟疑而失，宜果决把握', marriage: '姻缘迟误，良缘错过，宜果断有情', career: '事业优柔失机，宜当机立断', health: '体气迁延，小恙成疾，宜及早调治', lost: '失物坐失时机，恐难追回', travel: '出行坐误车期，宜早作准备', lawsuit: '讼失时机，所误非小，宜速应对' },
      advice: '坐失先机，下下。有些机会稍纵即逝，一步迟疑便步步落后，须以果断补之。'
    },
    {
      title: '飞蛾扑火', level: 'xia-xia',
      poem: ['夜蛾本自逐灯光', '扑火焚身徒自伤', '趋善避凶人共晓', '莫贪近利把身戕'],
      interpret: { home: '家中贪近利招焚，宜守清退避火', wealth: '财因贪近火爆仓，忌高利诱惑', marriage: '姻缘如飞蛾，沉迷而反受其伤', career: '事业妄进招损，宜退守蓄势', health: '体气燥进伤身，宜戒躁静养', lost: '失物因贪纵而失，恐为自弃', travel: '出行近祸，宜避火光喧闹之所', lawsuit: '讼因贪小而成怨，宜及早抽身' },
      advice: '飞蛾扑火，下下。越是诱人的近利越可能是陷阱，及时收手方能免于自伤。'
    },
    {
      title: '闭目塞听', level: 'xia-xia',
      poem: ['闭目塞听自蔽明', '良言逆耳总无情', '莫待祸来方省悟', '早开耳目察浮生'],
      interpret: { home: '家中自蔽而不纳劝，宜虚心纳言', wealth: '财因蔽听而偏，宜广开言路多听劝', marriage: '姻缘自蔽成隙，宜敞开心扉相交', career: '事业蔽塞视听，宜纳谏改过', health: '体气讳疾忌医，宜早察微防患', lost: '失物因蔽而南辕，反求其隅，难寻', travel: '行路闭塞，宜多问路况，莫一意行', lawsuit: '讼闭视听，失于偏听，宜求正听' },
      advice: '闭目塞听，下下。封闭自己只会让路越走越窄，打开耳目听听逆耳的忠言。'
    },
    {
      title: '殃及池鱼', level: 'xia-xia',
      poem: ['城门失火祸非轻', '池畔游鳞自受惊', '莫谓无辜能幸免', '趋避休将祸自迎'],
      interpret: { home: '家门恐受牵连，宜退避是非之地', wealth: '财被旁祸波及，宜切断纠葛', marriage: '姻缘受环境牵连，宜避扰乱之人', career: '事业卷涉是非，宜谨守自保', health: '身心受惊受扰，宜静处调神', lost: '失物遭池鱼之殃，恐被牵连而失', travel: '出行宜避兵荒是非之区', lawsuit: '讼被牵连，无辜受累，宜善自辨' },
      advice: '殃及池鱼，下下。城门失火，池鱼难免受累，尽量远离是非之地以自保。'
    },
    {
      title: '困龙得水', level: 'shang-shang',
      poem: ['困龙久困蛰深潭', '忽遇甘霖起大澜', '一朝得水风云会', '直上青霄振羽翰'],
      interpret: { home: '家运由困转通，忽得助力，宜振奋', wealth: '财运苦尽甘来，如龙得水，宜乘势进', marriage: '姻缘久待终得，两情共鸣，宜定盟誓', career: '事业久困忽通，时来运转，宜大展才', health: '沉疴逢愈，气血渐复，宜调养精神', lost: '失物久觅忽得，如龙得水，失而复还', travel: '行期逢利，困顿尽消，一路得助', lawsuit: '讼事久困忽解，得水而通，终能胜诉' },
      advice: '困龙得水，上上。蛰伏已久的困境终迎甘霖，转运就在当下，切莫再自困。'
    },
    {
      title: '寒梅傲雪', level: 'shang',
      poem: ['数九寒天梅自香', '一枝独俏压群芳', '任他风雪欺双鬓', '傲骨由来稳而且刚'],
      interpret: { home: '家道清贫而有节，以坚忍守之自安', wealth: '财困中自守节操，不宜妄求，守则吉', marriage: '姻缘冰清玉洁，历寒愈坚，宜守初心', career: '事业逆境立节，不畏艰难，终能出众', health: '体气耐寒，宜御寒保暖，自可无恙', lost: '失物寒中难觅，宜静待春回，或可现', travel: '行路多寒，宜备衣御寒，坚忍可达', lawsuit: '讼守节操，理直气坚，虽寒必伸' },
      advice: '寒梅傲雪，上吉。越是逆境越见风骨，守得住清贫孤傲，春来自当发花。'
    },
    {
      title: '沙里淘金', level: 'zhong-ji',
      poem: ['大浪淘沙始见金', '千淘万漉岂徒心', '从来美玉藏璞里', '苦尽甘来自可寻'],
      interpret: { home: '家计杂乱中理出清福，宜用心经营', wealth: '财须劳力细淘，小中见真，宜勤积', marriage: '姻缘于繁扰中觅真心，宜细察深品', career: '事业于众里建功，去粗取精，宜笃行', health: '体气须汰除余秽，宜净身净念养神', lost: '失物于杂处细寻，沙里藏之，可复得', travel: '行路多在劳顿，宜耐烦而行，终有获', lawsuit: '讼须于纷乱中辨真，宜细查明断' },
      advice: '沙里淘金，中吉。好东西总要历经淘洗才见真章，耐心细作，自有富矿可得。'
    },
    {
      title: '破镜重圆', level: 'zhong-ping',
      poem: ['菱花破镜两分飞', '岁月悠悠待月辉', '莫道情缘终已断', '圆时自有信来归'],
      interpret: { home: '家中离散之缘有望复合，宜以宽容处', wealth: '财散而复聚，断而复续，宜守旧情', marriage: '前缘复合，破镜重圆，今生再续', career: '事业中断处又接续，宜修补旧根基', health: '旧疾虽愈，旧症或复，宜防患复发', lost: '失物离散复得，破镜重圆，终可寻回', travel: '行期断续，离者将归，终能团圆', lawsuit: '久讼或可调解重圆，宜以和为合' },
      advice: '破镜重圆，中平。离散之事若能重新拼合，便是难得的好机缘，宜冰释前嫌。'
    },
    {
      title: '塞翁失马', level: 'zhong-ping',
      poem: ['塞翁失马未为殃', '祸福相倚尚未量', '眼前得失皆云影', '安知后日福来长'],
      interpret: { home: '家中偶有小失，勿忧勿躁，焉知非福', wealth: '眼前失利，后或得利，宜放长眼光', marriage: '姻缘失之东隅，收之桑榆，总有安排', career: '事业失利中伏转机，宜从容以待', health: '小恙偶发，视诸无常，静养可愈', lost: '失物虽失，勿悲勿执，或返为吉', travel: '行旅偶阻，前方自有好景，宜安心', lawsuit: '讼失不足深忧，祸福相倚，终有分晓' },
      advice: '塞翁失马，中平。看似坏事未必全坏，眼前这点损失，说不定正换未来的福。'
    },
    {
      title: '蹉跎岁月', level: 'zhong-ping',
      poem: ['岁月匆匆去不回', '空将壮志付蒿莱', '劝君莫待桑榆晚', '奋起应须及早来'],
      interpret: { home: '家中久疏经营，宜趁时振作，勿再蹉跎', wealth: '财因蹉跎而虚耗，宜早日止损整账', marriage: '姻缘因迟疑而迟，宜及时把握真情', career: '事业不宜再耽延，奋起毋待来日迟', health: '体气久耗待复，宜早调养迎生机', lost: '失物因蹉跎而失，宜早作寻觅打算', travel: '行期勿再迟延，宜决意速行', lawsuit: '讼因拖延不利，宜及早应对了结' },
      advice: '蹉跎岁月，中平。时光不等人，再拖延只会错失更多，奋起宜早不宜晚。'
    },
    {
      title: '紫府通神', level: 'shang-shang',
      poem: ['紫府琼楼接九天', '通神妙理自绵绵', '云车鹤驾寻常事', '福寿康宁万万年'],
      interpret: { home: '家宅紫气翔集，神明加护，宜修善积德', wealth: '财源通神，正偏皆旺，宜乘势大展', marriage: '姻缘天赐，两心相通，宜早结良缘', career: '功名通达，上达天庭，指日高升', health: '神明护佑，身康体健，百邪不侵', lost: '失物有神指引，静心以求，可得归', travel: '出行通神，贵人相佑，一路顺遂', lawsuit: '理通神明，理直自胜，无须挂怀' },
      advice: '紫府通神，上上大吉。所求之事有神明默佑，放心大胆去做，必有所成。'
    },
    {
      title: '五谷丰登', level: 'shang-shang',
      poem: ['五谷丰登仓廪满', '家家重译庆丰年', '春耕秋获皆如意', '人寿年丰福自全'],
      interpret: { home: '家业丰盈，仓廪俱实，宜长享天伦', wealth: '财利丰登，五谷满仓，宜广开财源', marriage: '姻缘丰美，家室和乐，宜成百年之好', career: '功成名就，硕果累累，宜更上层楼', health: '体魄丰健，元气充盈，康泰无忧', lost: '失物丰归，宜问市廛仓禀之处', travel: '行程丰顺，满载而归，一路平安', lawsuit: '讼事丰赢，得理而胜，宜以和终' },
      advice: '五谷丰登，上上。收成满满的时节，家业、财运、福气俱旺，好好珍惜。'
    },
    {
      title: '玉堂金马', level: 'shang-shang',
      poem: ['玉堂金马府门开', '锦绣文章动上台', '一举身登龙虎榜', '满城争看状元来'],
      interpret: { home: '家门显贵，玉堂生辉，宜光耀门楣', wealth: '财名俱显，金马玉堂，宜守贵业', marriage: '姻缘贵雅，门第相宜，宜缔高亲', career: '功名贵显，位居公卿，仕途无量', health: '身心贵泰，精神焕发，安康如意', lost: '失物贵重，宜往贵显之处寻', travel: '出行显达，荣归故里，一路辉煌', lawsuit: '讼以贵显之理胜，得大夫助' },
      advice: '玉堂金马，上上。这是显贵通达之象，名与利皆能兼得，放心去争一朝。'
    },
    {
      title: '月朗星稀', level: 'shang-shang',
      poem: ['月朗星稀夜气清', '一轮皓魄照中庭', '但教心地无尘翳', '何必求仙访缦亭'],
      interpret: { home: '家宅清朗，心地澄明，宜处净守和', wealth: '财路清明，皓月当空，宜稳健收纳', marriage: '姻缘澄净，月照心印，宜坦诚相守', career: '功名清朗，如水无尘，宜正大光明', health: '心地清凉，宿疾自退，宜养心调神', lost: '失物月明处寻，静夜细辨可复得', travel: '行路清明，皓月引路，平安无碍', lawsuit: '是非澄澈，如月昭然，宜静查明断' },
      advice: '月朗星稀，上上。此刻心境澄明，所求之事光明磊落，只管坦然前行。'
    },
    {
      title: '一马平川', level: 'shang',
      poem: ['一马平川踏月行', '蹄声得得报天明', '眼前纵有千重岭', '信步徐来过万程'],
      interpret: { home: '家运顺遂，四境通达，宜乘势而进', wealth: '财路坦荡，一马平川，宜广行交易', marriage: '姻缘顺遂，前程平坦，宜早定佳期', career: '功名坦达，平川在望，宜奋蹄直进', health: '气血通畅，步履轻健，安和无病', lost: '失物平川可寻，终能失而复得', travel: '出行坦荡，一路平川，通达无阻', lawsuit: '讼路平顺，理直自通，宜以和了' },
      advice: '一马平川，上吉。前路一马平川，顺风顺水，大胆策马向前，莫要迟疑。'
    },
    {
      title: '鹏程万里', level: 'shang',
      poem: ['鹏展垂天万里程', '一朝奋起上青冥', '长风送我凌云志', '直挂云帆破浪行'],
      interpret: { home: '家运腾达，气象恢弘，宜志存高远', wealth: '财程万里，鹏翼扶摇，宜顺势远图', marriage: '姻缘远大，志同道合，宜相携高飞', career: '功名远大，鹏程万里，宜大胆开拓', health: '体气充沛，如鹏高翔，精神百倍', lost: '失物远随，宜高处远寻，可得其踪', travel: '行程广阔，万里鹏程，所向披靡', lawsuit: '讼路长远，得胜有望，宜从容应付' },
      advice: '鹏程万里，上吉。志在千里者展翅高飞，眼前正是大展宏图的好时机。'
    },
    {
      title: '锦绣前程', level: 'shang',
      poem: ['锦绣前程步步宽', '红旗夹道振衣冠', '花明柳暗皆通路', '只待春风过玉栏'],
      interpret: { home: '家宅锦绣，门庭生辉，宜添彩增福', wealth: '财如锦帛，前程广阔，宜多元布局', marriage: '姻缘锦绣，前程似锦，宜早谐鸾凤', career: '功名锦绣，前程远大，宜奋力求进', health: '身似锦绣，气血皆足，安康常乐', lost: '失物锦绣处寻，或藏锦罗之中', travel: '出行锦绣，风光无限，一路繁华', lawsuit: '讼有锦绣之象，前程可期，宜从容' },
      advice: '锦绣前程，上吉。眼前铺开一幅华美画卷，脚踏实地，自能绘就大好前程。'
    },
    {
      title: '紫气东来', level: 'shang',
      poem: ['紫气东来满帝京', '祥光瑞霭自天倾', '云开日暖腾龙马', '得意春风万户迎'],
      interpret: { home: '紫气东来，瑞霭盈门，宜迎祥纳福', wealth: '财起东方，紫气所向，宜择吉而进', marriage: '姻缘祥瑞，喜气东来，宜定良缘', career: '功名得祥，紫气加身，宜大展宏图', health: '身心祥泰，瑞气护体，诸恙不侵', lost: '失物东向，宜沿紫气所及处寻', travel: '出行东吉，紫气引路，一路顺风', lawsuit: '讼逢紫气，理直气盛，从容者胜' },
      advice: '紫气东来，上吉。吉兆正自东方升起，抓住这股旺气，诸事皆宜。'
    },
    {
      title: '天赐良缘', level: 'shang',
      poem: ['天赐良缘岂偶然', '清风明月结因缘', '红绳系足心相印', '白首同心万古年'],
      interpret: { home: '家宅和合，喜气盈门，宜促成佳偶', wealth: '财缘天赐，人缘广结，宜广纳福源', marriage: '良缘天赐，两情相悦，宜早缔良盟', career: '功名有缘，机缘天降，宜及时把握', health: '身心和悦，姻缘养气，安然无恙', lost: '失物有缘复得，宜问彼女彼男处', travel: '行程有缘，良人相伴，一路和顺', lawsuit: '讼遇良缘之解，得贵人调和而息' },
      advice: '天赐良缘，上吉。缘分既已天赐，就好好把握，莫让眼前良缘从指缝溜走。'
    },
    {
      title: '青云直上', level: 'shang',
      poem: ['青云直上不须梯', '万里鹏程在此时', '但得心中无挂碍', '一朝平步上丹墀'],
      interpret: { home: '家运蒸腾，青云直上，宜扶摇而进', wealth: '财路青云，直指九霄，宜大胆进取', marriage: '姻缘青云，两情相得，宜共赴前程', career: '功名平步，青云直上，宜奋力攀登', health: '体气升腾，如登青云，精神焕发', lost: '失物青云处难寻，恐高不可攀', travel: '出行青云，前程万里，宜早日启程', lawsuit: '讼势青云，理高而胜，无须忧虑' },
      advice: '青云直上，上吉。仕途、事业正步步高升，乘此青云之势，直上九霄。'
    },
    {
      title: '喜从天降', level: 'shang',
      poem: ['喜从天降满门春', '忽报佳音到屋头', '莫道眼前无所获', '转头欢喜自相投'],
      interpret: { home: '家宅喜气临门，天降佳音，宜以待喜事', wealth: '财喜天降，进账忽来，宜善加分配', marriage: '姻缘喜从天降，佳音忽至，宜成好事', career: '功名喜报频传，喜从天降，宜承其喜', health: '身心欢喜，气自顺畅，百病不作', lost: '失物忽而复还，喜从天降，可得之', travel: '出行天降佳音，好事相随，一路欢喜', lawsuit: '讼获佳音，喜从天降，宜和喜了结' },
      advice: '喜从天降，上吉。好事正在来的路上，可能是意外的惊喜，放宽心迎接。'
    },
    {
      title: '高堂满座', level: 'shang',
      poem: ['高堂满座庆团圆', '子孝孙贤共一庭', '洒扫庭除迎贵客', '家和人乐福长绵'],
      interpret: { home: '高堂满座，人丁兴旺，宜广聚天伦', wealth: '财源盈贯，宾客盈门，宜广结善缘', marriage: '姻缘美满，亲友共贺，宜早谐连理', career: '功名有人相助，贵客临门，宜善用', health: '身心愉悦，和气养人，安和无病', lost: '失物在堂聚处，宜问座上宾客可寻', travel: '出行迎贵，宾客相送，一路顺遂', lawsuit: '讼得众人公评，公道自在，宜和' },
      advice: '高堂满座，上吉。人缘与和气俱足，广结善缘，福气自然满堂。'
    },
    {
      title: '鸾凤和鸣', level: 'shang',
      poem: ['鸾凤和鸣庆有家', '双双比翼在天涯', '同心结就三生愿', '锦瑟年华共岁华'],
      interpret: { home: '家室和乐，鸾凤和鸣，宜琴瑟相御', wealth: '财姻两旺，比翼双飞，宜共同经营', marriage: '姻缘和鸣，鸾凤配契，宜速成连理', career: '功名和顺，夫妻同心，宜相扶成事', health: '身心和畅，两情相养，安泰无恙', lost: '失物夫妻同心寻，比翼觅处可复得', travel: '行旅和顺，双宿双飞，一路平安', lawsuit: '讼以和鸣解之，夫妻同心，宜息' },
      advice: '鸾凤和鸣，上吉。夫妇和顺、彼此扶持，正是家和万事兴的好光景。'
    },
    {
      title: '鱼跃龙门', level: 'shang',
      poem: ['鱼跃龙门振尺鳞', '一翻风雨上青云', '成龙变化非虚语', '会向天河报课晨'],
      interpret: { home: '家运因变而兴，宜庆门户生辉', wealth: '财如鱼跃，一跃而成，宜敢作敢为', marriage: '姻缘跃变，门当户对，宜成其美', career: '功名一跃，突破龙门，事在人为', health: '体气跃动，生机勃发，愈养愈健', lost: '失物多经翻覆，宁持恒心以待', travel: '出行一跃，前程突变，宜顺势而进', lawsuit: '讼经翻覆而胜，如鱼跃龙门得苏' },
      advice: '鱼跃龙门，上吉。突破的关键时刻就在眼前，奋力一跃，自会化龙升天。'
    },
    {
      title: '心想事成', level: 'shang',
      poem: ['心想事成岂偶然', '精诚所至感苍天', '一愿既遂心先喜', '百念皆随福自延'],
      interpret: { home: '家事心遂，人愿皆成，宜乐享清和', wealth: '财想即遂，心想事成，宜循愿而行', marriage: '姻缘心遂，两心如镜，宜早结良缘', career: '功名如愿，心想事成，宜依志进取', health: '心想身畅，神随志舒，安然无病', lost: '失物心念所及，静心默想或得其踪', travel: '行程如愿，心之所向，必有回应', lawsuit: '讼合心愿，事必遂心，宜从容处之' },
      advice: '心想事成，上吉。心诚则灵，坚定信念勇往直前，所愿之事皆可成真。'
    },
    {
      title: '步步高升', level: 'shang',
      poem: ['步步高升上玉京', '风扶乳燕入云轻', '前头自有通天路', '稳步徐登不暂停'],
      interpret: { home: '家运节节升高，宜庆门楣新光', wealth: '财步步高升，宜循序加码投资', marriage: '姻缘步步升高，门第日隆，宜相配', career: '功名步步高升，官阶日进，宜勤勉', health: '体气日日向健，宜量力渐进', lost: '失物渐寻渐得，步步追查，或可寻回', travel: '行程高升，山路徐登，终登其巅', lawsuit: '讼逐次得胜，步步为营，终得其直' },
      advice: '步步高升，上吉。不要指望一步登天，一步一个脚印，自能步步登高。'
    },
    {
      title: '前程似锦', level: 'shang',
      poem: ['前程似锦艳天青', '万里虹桥接玉京', '但得心中存锦绣', '何须着意问枯荣'],
      interpret: { home: '家宅如锦绣铺展，宜张灯添彩增华', wealth: '财程似锦，蒸蒸日上，宜广植财源', marriage: '姻缘如锦，华美可期，宜早定佳盟', career: '功名如锦，前程远大，宜奋然图新', health: '身心似锦，精神焕发，康泰无忧', lost: '失物藏于锦绣处，宜遍寻华美之所', travel: '行程似锦，风光正好，一路顺遂', lawsuit: '讼含锦绣之望，理直从容，宜待佳音' },
      advice: '前程似锦，上吉。前方铺开一片锦绣，满怀信心往前走，定能绘出美好未来。'
    },
    {
      title: '柳暗花明', level: 'zhong-ji',
      poem: ['柳暗花明又一村', '前头历尽几重门', '山重水复疑无路', '俄见春光照满原'],
      interpret: { home: '家前路转，柳暗花明，宜待其自清', wealth: '财柳暗花明，转机立现，宜再坚持', marriage: '姻缘柳暗花明，绝处逢缘，宜多留心', career: '功名梅经重雾，一转即通，宜勿放弃', health: '沉疴柳暗花明，渐有起色，宜加调养', lost: '失物柳暗花明，转寻他方或可得之', travel: '行程柳暗花明，困顿后即见坦途', lawsuit: '讼途柳暗花明，转危为，宜耐心周旋' },
      advice: '柳暗花明，中吉。眼看无路处，一转角便是光明，坚持别放弃就有转机。'
    },
    {
      title: '安居乐业', level: 'zhong-ji',
      poem: ['安家乐业喜长暇', '万石仓箱遍种麻', '守得本业常安稳', '何须占卜问年华'],
      interpret: { home: '家业安稳，居处和乐，宜守本安心', wealth: '财从本业中来，宜安分经营田亩', marriage: '姻缘安稳，家室和乐，宜长相厮守', career: '功名安土，守正自得，宜循业而进', health: '身心安稳，作息有时，安而康健', lost: '失物安处寻之，守常处或可复得', travel: '行程安和，宜安居而少远行', lawsuit: '讼宜安分守成，守理自能了结' },
      advice: '安居乐业，中吉。不求轰轰烈烈，守住本分把日子过安稳，便是实在的福。'
    },
    {
      title: '积善之家', level: 'zhong-ji',
      poem: ['积善之家庆有余', '儿孙绕膝夜读书', '今朝种得因缘好', '他日还酬报果初'],
      interpret: { home: '家积行善，余庆多端，宜传家以德', wealth: '财由善积，余庆必偿，宜广行义举', marriage: '姻缘由善缔结，福世结缘，宜惜缘', career: '功名善中求，积德自通，宜立德立言', health: '身心行善，气自和顺，百邪不侵', lost: '失物因善而还，行善处可寻其踪', travel: '行程善行相随，积善之家多贵人', lawsuit: '讼以善解，行善处多得善人公断' },
      advice: '积善之家，中吉。行善积德的人家福气绵长，多做好事，福必及身及子孙。'
    },
    {
      title: '六合同春', level: 'zhong-ji',
      poem: ['六合同春万象苏', '凤鸣岐山沐化乎', '春风先到多情处', '和煦恩流遍九衢'],
      interpret: { home: '家六合安宁，一门和染，宜喜庆团聚', wealth: '财六路亨通，和合聚财，宜和衷共济', marriage: '姻缘六合，和合相得，宜速成佳偶', career: '功名六通畅达，和合助力，宜广纳', health: '身心温和，六脉调和，安和无恙', lost: '失物六合处寻，和合人家或可寻回', travel: '行程和合，六路皆通，一路顺遂', lawsuit: '讼逢和合，得中调解，宜以和为贵' },
      advice: '六合同春，中吉。六合之内生意盎然，以和为贵、以合聚福，万事顺遂。'
    },
    {
      title: '龙凤呈祥', level: 'zhong-ji',
      poem: ['龙凤呈祥兆吉祥', '云开麟趾舞朝阳', '天心眷顾诚难遇', '福禄绵绵百代长'],
      interpret: { home: '家逢祥瑞，龙凤呈祥，宜庆其福', wealth: '财源祥聚，龙凤共襄，宜广纳财源', marriage: '姻缘祥瑞，龙凤相配，宜成鸾凤之盟', career: '功名呈祥，龙腾凤舞，宜大展宏图', health: '身心祥泰，龙凤护体，安和无病', lost: '失物祥兆处寻，循迹追踪或可复得', travel: '行程呈祥，龙行凤从，一路平安', lawsuit: '讼逢祥兆，理直而和，宜从容了结' },
      advice: '龙凤呈祥，中吉。吉瑞之兆已现，夫妻和顺、家业兴旺，福气绵延。'
    },
    {
      title: '骏马奔腾', level: 'zhong-ji',
      poem: ['骏马奔腾踏绿茵', '奋蹄扬鬃绝风尘', '休言半日奔驰苦', '自在长空独绝伦'],
      interpret: { home: '家运奔腾向上，宜振奋门风精神', wealth: '财如骏马奔腾，但宜防其过猛', marriage: '姻缘奔放有志，宜选志向相投者', career: '功名奔驰朝进，宜使出浑身气力', health: '体气奔放，宜量力为之，防过劳', lost: '失物奔驰难及，恐已远随其逝', travel: '行程奔驰，疾行远走，宜适可而止', lawsuit: '讼势奔腾，宜制其锋芒，徐图安胜' },
      advice: '骏马奔腾，中吉。精力旺、劲头足，但也要注意节奏，别让冲劲变成冲动。'
    },
    {
      title: '苍松翠柏', level: 'zhong-ji',
      poem: ['苍松翠柏岁寒心', '历尽霜雪气更深', '留得青山长不老', '一番风雨更添岑'],
      interpret: { home: '家基如山，苍松常青，宜守根本', wealth: '财源如松，历久弥坚，宜长线布局', marriage: '姻缘如松，历寒弥坚，宜守初心', career: '功名如松，历霜成材，宜坚持不懈', health: '体魄如松，耐寒耐劳，宜强身健体', lost: '失物于深林处难寻，恐终难复见', travel: '行程亦须历艰，松柏之志可胜', lawsuit: '讼以坚忍胜，如松耐霜，终得其直' },
      advice: '苍松翠柏，中吉。越是考验越见风骨，坚定心志，历尽霜雪终成栋梁。'
    },
    {
      title: '春回大地', level: 'zhong-ji',
      poem: ['春回大地草芊芊', '万紫千红尽可怜', '莫道寒威犹未尽', '东风一夜绿山川'],
      interpret: { home: '家运逢春，万象更新，宜纳新除旧', wealth: '财回春而旺，宜趁势播种经营', marriage: '姻缘回春，枯木发华，宜再试诚心', career: '功名春回，气象新开，宜奋发而上', health: '体气回春，生机焕发，宜调养健身', lost: '失物逢春而生，宜往向阳新处寻', travel: '行程回春，寒尽暖来，宜择吉启程', lawsuit: '讼遇春回之机，转圜有地，宜利用' },
      advice: '春回大地，中吉。寒冬已过、万物复苏，正是重整旗鼓、播种希望的时节。'
    },
    {
      title: '万象更新', level: 'zhong-ji',
      poem: ['万象更新又一春', '山花水月总相亲', '昨朝晦色随风去', '今喜朝阳满画门'],
      interpret: { home: '家宅更新，气象一新，宜图修缮振兴', wealth: '财象更新，新机迭出，宜开新渠道', marriage: '姻缘更新，旧嫌尽释，宜重续前缘', career: '功名更新，新程将启，宜大胆开创', health: '身象更新，旧疾尽去，宜重理生活', lost: '失物更新处寻，旧处扫尽或有所见', travel: '行程更新，弃旧从新，宜择新路', lawsuit: '讼象更新，旧怨可释，宜翻新和解' },
      advice: '万象更新，中吉。旧的要翻篇、新的要开篇，放下过去，迎来崭新的好气象。'
    },
    {
      title: '福至心灵', level: 'zhong-ji',
      poem: ['福至心灵一念通', '千祥云集自融融', '但行好事何须问', '自有神明报始终'],
      interpret: { home: '家得福佑，心地清明，宜行善积庆', wealth: '财福相随，福至心灵，宜积德进财', marriage: '姻缘福至，两心相通，宜顺缘而成', career: '功名福挟而行，心有灵犀，宜依智', health: '身心福临，气自清灵，宜养慧静心', lost: '失物福引心启，静心默想可得之', travel: '行程福至，机缘巧合，宜随缘而行', lawsuit: '讼福至而解，心有善念，宜以德化' },
      advice: '福至心灵，中吉。福气到了，心思也格外清明，乘机多行好事，福上加福。'
    },
    {
      title: '乘风破浪', level: 'zhong-ji',
      poem: ['乘风破浪驾长舟', '万里沧溟不放兜', '须信扬帆须得济', '回头已过数重洲'],
      interpret: { home: '家运迎风而上，宜励精图治门风', wealth: '财乘长风，破浪而进，宜大胆投资', marriage: '姻缘乘风，互励共进，宜共济前程', career: '功名破浪而来，扬帆得济，宜勇进', health: '体气乘风，元气充盈，宜动中养身', lost: '失物乘浪去远，恐已随水难追', travel: '行程乘风破浪，扬帆远航，大有可为', lawsuit: '讼途乘风，得势而进，宜乘胜收兵' },
      advice: '乘风破浪，中吉。趁势而进，迎难而上，正是把大船开向远方的时候。'
    },
    {
      title: '温故知新', level: 'zhong-ji',
      poem: ['温故知新自有得', '旧书重翻味愈长', '本末兼修心自明', '反观内照乐无疆'],
      interpret: { home: '家遵旧训，又知新理，宜承先启后', wealth: '财温旧业而知新途，宜复盘再进', marriage: '姻缘重温旧好，更知真情，宜续前缘', career: '功名温故知新，运筹有新，宜善用', health: '体重温脉，知行知养，宜察其本源', lost: '失物重温旧踪，回溯去路或可复见', travel: '行程温旧路而知新程，宜备先行', lawsuit: '讼温旧卷而知新理，宜从容申辨' },
      advice: '温故知新，中吉。回头细看旧事能悟出新道理，多方揣摩，自有所得。'
    },
    {
      title: '见微知著', level: 'zhong-ji',
      poem: ['见微知著本先机', '一叶知秋正是宜', '莫待事临方觉晚', '早看端倪早胜须臾'],
      interpret: { home: '家事防微杜渐，见微知著，宜早理防患', wealth: '财察先机，见微知著，宜早作布局', marriage: '姻缘察微知著，知心相惜，宜加珍惜', career: '功名先机在握，见微知著，宜善决断', health: '体察微意，早防旧疾，宜早诊早治', lost: '失物察其端倪，循小迹寻之或可得', travel: '行路见微，预知险阻，宜早作规避', lawsuit: '讼见其几，先机在握，宜早为之计' },
      advice: '见微知著，中吉。从小处看出大趋势，抓住细微信号早作判断，能避祸立功。'
    },
    {
      title: '脚踏实地', level: 'zhong-ji',
      poem: ['脚踏实地步徐行', '不问虚名只问诚', '万里征途从脚下', '功夫到处路自平'],
      interpret: { home: '家凭实效经营，脚踏实地，宜务实持家', wealth: '财脚踏实地，滴滴累积，宜勤作实储', marriage: '姻缘务实相守，不尚虚华，宜真实', career: '功名一步一印，踏实肯干，终见其成', health: '体凭实养，作息有常，安然康健', lost: '失物实地细寻，脚踏实地逐处可查', travel: '行程脚踏实地，步步为营，终达其地', lawsuit: '讼贵以实持之，脚踏实地之理可恃' },
      advice: '脚踏实地，中吉。不慕虚荣、不图捷径，把每件实在事做好，路自会越走越平。'
    },
    {
      title: '厚积薄发', level: 'zhong-ji',
      poem: ['厚积薄发自有时', '潜藏未露待明时', '一朝得势风云会', '识得当年蓄势奇'],
      interpret: { home: '家积德深厚，日渐蓄势，宜久蓄门风', wealth: '财厚积而薄发，宜蓄深后再放水', marriage: '姻缘厚积而后成，宜深养情意待机', career: '功名厚积储才，薄发先露，宜蓄力', health: '体气厚积，宜养精蓄锐，待机而动', lost: '失物蓄藏未现，宜深掘久寻，勿弃', travel: '行程蓄势而动，未至其时宜静养', lawsuit: '讼宜厚积证据，待机薄发，终可操胜' },
      advice: '厚积薄发，中吉。平日不断积累沉淀，时机一到便能薄发而出，不必急于一时。'
    },
    {
      title: '否极泰来', level: 'zhong-ji',
      poem: ['否极泰来理自然', '天心一转自回旋', '从来福祸相依伏', '否尽爻中泰自全'],
      interpret: { home: '家运否极泰来，转危为安，宜守其常', wealth: '财否极泰来，低谷将尽，宜抄底布局', marriage: '姻缘否极转泰，旧隙将释，宜待转机', career: '功名否极泰来，困顿即止，宜把握', health: '沉疴否极，转泰生安，宜调养回春', lost: '失物否极，久觅将复，宜更续追寻', travel: '行程否极泰来，阻滞将通，宜待其顺', lawsuit: '讼否极泰来，转祸为福，宜静候公理' },
      advice: '否极泰来，中吉。最坏的将要过去，转好的苗头已经出现，撑过这关便见春暖。'
    },
    {
      title: '吉星高照', level: 'zhong-ji',
      poem: ['吉星高照宅光辉', '祥光瑞气自朝晖', '但得心宽平气定', '何愁福薄命多违'],
      interpret: { home: '家宅吉星高照，祥光辉映，宜庆其福', wealth: '财星高照，吉运当头，宜顺势而图', marriage: '姻缘吉星护佑，红鸾临门，宜成好事', career: '功名吉星高照，运势亨通，宜奋登', health: '身体吉星庇佑，气定神闲，安然无病', lost: '失物吉星所照之处，宜朝光处寻', travel: '行程吉星引路，一路光明，平安顺遂', lawsuit: '讼逢吉星照拂，理直气盛，宜从容胜' },
      advice: '吉星高照，中吉。好运正笼罩着你，放宽心态、厘清方向，凡事都会顺遂许多。'
    },
    {
      title: '开源节流', level: 'zhong-ji',
      poem: ['开源节流衣食足', '春秋兴尽笑声多', '度得勤俭方长久', '何患家资不渐多'],
      interpret: { home: '家门勤朴，开源节流，宜勤俭持家', wealth: '财开源又节流，足食足用，宜善经理', marriage: '姻缘相勤相俭，同甘共苦，宜相守', career: '功名开源生路，节流守成，宜兼顾', health: '身以养为开源，作息节流，宜均衡', lost: '失物节流处之，俭中细察或可寻回', travel: '行程节用开源，盘餐自足，宜量入', lawsuit: '讼宜节流少费，开源生财，从容应付' },
      advice: '开源节流，中吉。一面多开财路、一面节制花销，细水方能长流，家业渐丰。'
    },
    {
      title: '日升月恒', level: 'zhong-ping',
      poem: ['日升月恒最久常', '盈亏圆缺总相将', '人间那得长圆满', '但守恒心自寿康'],
      interpret: { home: '家如日月，恒久相照，宜守常安泰', wealth: '财如日升月恒，随周而复始，宜守成', marriage: '姻缘如日月，久处情长，宜以常处', career: '功名日升月恒，循序而进，宜守渐', health: '体如日月，盈亏有度，宜养恒常之心', lost: '失物如月有盈亏，久别或可复见', travel: '行程如月周期，宜择时而动', lawsuit: '讼如日月有升降，宜待其定，毋躁' },
      advice: '日升月恒，中平。世间本无日日圆满，贵在持之以恒，平常心对待得失浮沉。'
    },
    {
      title: '平安如意', level: 'zhong-ping',
      poem: ['平安如意两相酬', '守拙随时不必忧', '莫羡他人多富足', '自家安稳即是秋'],
      interpret: { home: '家宅平安，如心遂意，宜守清守和', wealth: '财平稳如意，不求骤富，宜安分聚财', marriage: '姻缘平安，处处如意，宜长相守', career: '功名平稳，不求骤进，宜安分自守', health: '身心平安，如心得福，最足宝贵', lost: '失物平实处寻，一时未得勿焦躁', travel: '行程平安，求顺即可，不宜涉险', lawsuit: '讼宜平安求了，以息争为贵，宜和' },
      advice: '平安如意，中平。平安二字最是难得，把日子过得安稳平顺，便是事事如意。'
    },
    {
      title: '安分守己', level: 'zhong-ping',
      poem: ['安分守己度晨昏', '不作非分妄想奔', '守得清白心自定', '何劳天地问亏盈'],
      interpret: { home: '家守本分，各安其位，宜持常守正', wealth: '财守分内，木无佞求，宜守正俭用', marriage: '姻缘守本分，两相回护，宜以诚养', career: '功名守分，不急慕高，宜安其所业', health: '身心守常，作息有节，安而不劳', lost: '失物守本处未动，宜守常以待', travel: '行程守常勿妄，宜循规而行', lawsuit: '讼守己分，不负于人，理直自安' },
      advice: '安分守己，中平。守住本分、不铺张不求奢，心定而后身安，自有清福。'
    },
    {
      title: '循规蹈矩', level: 'zhong-ping',
      poem: ['循规蹈矩步从容', '不越雷池自养锋', '莫道拘泥无大用', '年深自有一番工'],
      interpret: { home: '家门崇礼守规，长幼有序，宜循礼', wealth: '财循规而聚，不越界贪，宜守纪经营', marriage: '姻缘循礼相待，从容有度，宜守份', career: '功名循规渐进，守矩而进，宜循章', health: '体循常度，起居有节，宜守其规', lost: '失物循旧路寻，规矩处查或可复得', travel: '行程循规而行，凡进必合，宜守度', lawsuit: '讼循规求理，有条不紊，宜依法而理' },
      advice: '循规蹈矩，中平。规矩之内虽无大惊喜，却稳当不翻车，稳妥便是长久之道。'
    },
    {
      title: '循序渐进', level: 'zhong-ping',
      poem: ['循序渐进得机宜', '一进一亏理可推', '莫道行迟为下策', '自知跬步至千里'],
      interpret: { home: '家运渐进而安，循序渐进，宜守其序', wealth: '财循序渐积，积少成多，宜稳中增储', marriage: '姻缘循序而笃，渐深渐浓，宜相渐进', career: '功名循序渐进，不求速至，宜量力而行', health: '体气循序而养，渐复旧观，宜渐进锻炼', lost: '失物循序细查，逐处推进，或可寻回', travel: '行程循序而进，步步为营，终达其地', lawsuit: '讼循序渐进，理周事备，宜从容应对' },
      advice: '循序渐进，中平。罗马不是一天建成，按部就班、一步一步来，终能致千里。'
    },
    {
      title: '细水长流', level: 'zhong-ping',
      poem: ['细水长流不计程', '涓涓终可汇沧溟', '休言一日难成海', '积石成山路自明'],
      interpret: { home: '家道涓涓相续，细水长流，宜惜其源', wealth: '财涓滴成河，细水长流，宜长期储蓄', marriage: '姻缘细水长流，绵长耐久，宜慢慢养', career: '功名涓积而成，宜持之以恒，勿以善小', health: '体宜细水长养，涓养血脉，贵在常养', lost: '失物涓踪循迹，长流处可寻其源', travel: '行程细水行稳，不争朝夕，宜从容', lawsuit: '讼宜细水周旋，徐徐图之，终得其当' },
      advice: '细水长流，中平。涓涓细流终能汇成大海，持之以恒，莫嫌弃微小之功。'
    },
    {
      title: '知足常乐', level: 'zhong-ping',
      poem: ['知足常乐意宽和', '何须争竞逐多波', '一瓢一箪清有味', '菜根咬罢味偏和'],
      interpret: { home: '家道知足，清和自居，宜安贫乐道', wealth: '财知足有度，免贪招损，宜守常安享', marriage: '姻缘知足相守，清贫有味，宜惜缘分', career: '功名知足自乐，不求贪位，宜安其所求', health: '身心知足，气自和畅，宜养静守中', lost: '失物知足处不必深究，得失随缘即可', travel: '行程知足常乐，随遇即安，不慕险远', lawsuit: '讼知足肯退，能息则息，宜少争少求' },
      advice: '知足常乐，中平。欲望适可而止，知足方能常乐，眼前的清安便是好日子。'
    },
    {
      title: '随遇而安', level: 'zhong-ping',
      poem: ['随遇而安体自舒', '红尘来去总烟如', '但得心安身便泰', '何须计较与盈虚'],
      interpret: { home: '家随遇而安，处变不惊，宜平心以居', wealth: '财随遇而安，不贪不急，宜守如常', marriage: '姻缘随遇而安，不执不拗，宜随缘自适', career: '功名随遇而安，不慕荣进，宜安其境', health: '身心随遇而安，不拘自和，宜静养', lost: '失物随缘而来，得失不索，宜安其心', travel: '行程随遇而安，随缘而行，宜自得', lawsuit: '讼随遇而安，处之泰然，宜静观其变' },
      advice: '随遇而安，中平。既来之则安之，不苛求、不强求，心平气和最为养福。'
    },
    {
      title: '听天由命', level: 'zhong-ping',
      poem: ['听天由命且宽怀', '祸福由来命里排', '莫使愁眉长锁目', '开怀一笑自安排'],
      interpret: { home: '家事听由天命，处泰然，宜放其怀', wealth: '财纵任天意，勿强求，宜随分守中', marriage: '姻缘听凭天定，莫强求，宜从容以待', career: '功名付之天命，不必强争，宜守其分', health: '体气任其自然，宜宽心调养，莫忧惧', lost: '失物听天由命，勿强寻，静待其返', travel: '行程任其自然，宜随遇而行，不执著', lawsuit: '讼听天命公断，不必强求，宜从容待之' },
      advice: '听天由命，中平。有些事尽力便罢，剩下的交由天意安排，放宽心怀顺其自然。'
    },
    {
      title: '顺其自然', level: 'zhong-ping',
      poem: ['顺其自然莫强求', '春生秋熟各悠悠', '叶落花开皆有定', '何须戚戚挂心头'],
      interpret: { home: '家顺其自然，不强为，宜守无为之道', wealth: '财顺天时而动，不强求，宜循自然', marriage: '姻缘顺其自然，不强牵合，宜随缘', career: '功名顺时而动，不争不抢，宜顺其势', health: '体顺自然调养，勿妄进妄补，宜中和', lost: '失物顺时而寻，强之不得，随缘以待', travel: '行程顺其自然，不强赶路，宜从心', lawsuit: '讼顺其自然，不强求胜，宜息事宁人' },
      advice: '顺其自然，中平。时机未到莫强求，顺应天地自然的节律，该来的自会来。'
    },
    {
      title: '稳扎稳打', level: 'zhong-ping',
      poem: ['稳扎稳打步步营', '不先锋锐自徐行', '阵地固时心自定', '从容制胜胜中明'],
      interpret: { home: '家稳扎根基，不动如山，宜守其盘', wealth: '财稳扎而积，不追急利，宜守正经营', marriage: '姻缘稳扎相守，不浮不躁，宜以实爱', career: '功名稳扎稳打，固本而后进，宜迟成', health: '体稳扎根基，循序渐进，宜养正固本', lost: '失物稳扎细觅，勿乱其阵，终有所获', travel: '行程稳扎每步，不宜冒进而失其据', lawsuit: '讼稳扎取证，从容应对，步步为营' },
      advice: '稳扎稳打，中平。不求速胜，先把每一步走扎实，根基稳了自然立于不败。'
    },
    {
      title: '滴水穿石', level: 'zhong-ping',
      poem: ['滴水穿石历岁年', '檐前点滴落层巅', '莫嫌力小功难竟', '久则为山亦穿穿'],
      interpret: { home: '家以滴水之力，积微成著，宜贵有恒', wealth: '财滴水积蓄，累小成大，宜长期坚持', marriage: '姻缘滴水润物，日久情深，宜贵加持恒', career: '功名滴水成渠，久见其功，宜恒笃行', health: '体滴水养元，功在日积，宜贵迟养', lost: '失物久寻细觅，如滴穿石，终可复见', travel: '行程滴水寸进，不畏其缓，宜持之以恒', lawsuit: '讼持恒以理，滴水穿石，终能分明' },
      advice: '滴水穿石，中平。力量虽小，贵在坚持，日复一日终能成就不可思议之事。'
    },
    {
      title: '老成持重', level: 'zhong-ping',
      poem: ['老成持重不轻狂', '一让三思虑自长', '莫哂迟回循旧例', '稳重由来免祸殃'],
      interpret: { home: '家道老成，长辈安和，宜尊老守礼', wealth: '财老成守计，不冒不急，宜稳重聚财', marriage: '姻缘持重视之，不轻诺，宜以沉稳处', career: '功名老成谋事，必周且远，宜迟重', health: '体高年养正，持重防跌，宜防微杜渐', lost: '失物老成细查，不躁不弃，或可得之', travel: '行程老成少险，宁迟勿疾，宜稳重行', lawsuit: '讼老成应对，三思而后行，宜缓决断' },
      advice: '老成持重，中平。遇事多加三思、谋定而后动，稳重沉着往往能避祸去险。'
    },
    {
      title: '安之若素', level: 'zhong-ping',
      poem: ['安之若素守平和', '荣辱从来一往过', '宠辱不惊成大道', '心如止水自扬波'],
      interpret: { home: '家处变不惊，安之若素，宜守中和', wealth: '财荣辱不惊，得失无意，宜守其常', marriage: '姻缘安之若素，宠辱不惊，宜平淡相守', career: '功名遇挫不馁，处之泰然，宜徐图之', health: '体气定神闲，荣辱不扰，宜养其神', lost: '失物安之若素，得失随缘，宜静其心', travel: '行程随遇而安，处变处常，安而得宜', lawsuit: '讼宠辱不惊，安之若素，理自在焉' },
      advice: '安之若素，中平。无论兴衰荣辱都能平静对待，心如止水，祸福自不能撩动你。'
    },
    {
      title: '劳而有获', level: 'zhong-ping',
      poem: ['劳而有获理之常', '一勤一俭自当偿', '莫辞耕耘多碌碌', '秋来仓实果盈堂'],
      interpret: { home: '家勤而有获，盈积常集，宜勤以持家', wealth: '财劳而后获，天道酬勤，宜勤作实储', marriage: '姻缘勤中结好，两勤相得，宜共耕耘', career: '功名劳而有获，耕耘有获，宜勤恳为', health: '体劳逸有节，劳而有获，宜劳养相宜', lost: '失物勤搜细觅，付力之劳或可复得', travel: '行程勤劳所至，付力而得，宜踏实行', lawsuit: '讼勤于收集证据，劳而有获，宜耐心' },
      advice: '劳而有获，中平。天道酬勤，付出多少辛苦便有多少收获，只管勤恳去做。'
    },
    {
      title: '苦尽甘来', level: 'zhong-ping',
      poem: ['苦尽甘来食转香', '寒梅历雪吐春光', '吃得黄连根上苦', '自得蔗尾味中长'],
      interpret: { home: '家苦尽甘来，困而复苏，宜守至其甘', wealth: '财先苦后甘，苦尽甜至，宜守贫待泰', marriage: '姻缘苦尽，共患难后定见甘，宜相守', career: '功名先难后成，苦尽甘来，宜不屈', health: '沉珂苦尽而生，甘来渐愈，宜守待复', lost: '失物苦觅多时，苦尽之时或复得', travel: '行程苦尽甘来，涉难之后渐入佳境', lawsuit: '讼苦尽而后甘，久磨之下终得所直' },
      advice: '苦尽甘来，中平。先把苦头吃透，熬过这道难关，甘甜的果子正在后头等你。'
    },
    {
      title: '东隅桑榆', level: 'zhong-ping',
      poem: ['东隅已失日将昏', '莫道桑榆晚景贫', '自把余晖勤补缀', '偏教寒照暖还温'],
      interpret: { home: '家失之东隅，收之桑榆，宜及时补过', wealth: '财失于前，得于后，宜以俭补其亏', marriage: '姻缘失诸昔日，收诸桑榆，宜重和好', career: '功名晚成亦然，桑榆之补，宜勿自弃', health: '年高尤宜保养，补其损耗，宜及早养', lost: '失物宜桑榆之期寻，迟来亦可复得', travel: '行程迟暮犹可，宜择时补进，莫言晚', lawsuit: '讼失一时，收诸后日，宜以久持之' },
      advice: '东隅桑榆，中平。错过了清晨不要紧，桑榆晚景依然可以补救，亡羊补牢未为晚也。'
    },
    {
      title: '山重水复', level: 'xia-xia',
      poem: ['山重水复路难寻', '歧道茫茫几万岑', '行到尽头疑无路', '回看毕竟费沉吟'],
      interpret: { home: '家前路反复，山重水复，宜静观慎处', wealth: '财途重叠难寻，宜收束免损,慎勿妄动', marriage: '姻缘山重亦阻，今多反复，莫急就', career: '功名荆棘阻路，不宜妄进,宜守拙', health: '体气反复难安，宜静养调摄,慎用药', lost: '失物迷于重峦，难觅其径，恐难复得', travel: '行程重水幽阻，宜暂休整，不宜远行', lawsuit: '讼路反复，宜慎以处之，毋轻进退' },
      advice: '山重水复，下下。眼前反复纠缠、进退两难，宜暂作整顿，休要冒进。'
    },
    {
      title: '江心补漏', level: 'xia-xia',
      poem: ['江心补漏祸难追', '舟行水半始堪危', '莫待病成方悔悟', '防微早在未形时'],
      interpret: { home: '家道已生隐患，始补已迟，宜及早防之', wealth: '财临危始补救，损失在即，忌拖延误事', marriage: '姻缘隙已渐成，迟到弥补，恐难挽回', career: '功名积弊已深，临败始图，宜速改弦', health: '病起已深始医，江心补漏，宜早诊治', lost: '失物临急方寻，恐已难挽，宜及时追', travel: '行程临险始防，后悔已迟，宜早安排', lawsuit: '讼至临头始备，措手不及，宜早谋划' },
      advice: '江心补漏，下下。等到船到江中才补漏洞，多半来不及了，凡事及早防备为上。'
    },
    {
      title: '缘木求鱼', level: 'xia-xia',
      poem: ['缘木求鱼枉费功', '攀枝登树总无功', '本非鱼所栖居处', '错认高枝作水东'],
      interpret: { home: '家求非所宜，取向荒谬，宜改弦更张', wealth: '财求之非道，缘木无鱼，忌投机取巧', marriage: '姻缘所求非人，取向乖戾，宜认清现实', career: '事业开其莫能至，缘木求鱼，宜务实', health: '自治其非其道，缘木无补，宜就正医', lost: '失物缘木而求，殊途南辕，恐难寻得', travel: '行向非其所当，几经歧途，宜辨方向', lawsuit: '讼求理于无凭，缘木而求，宜就正道' },
      advice: '缘木求鱼，下下。方向一开始就错了，再卖力也白费，不如及早回头找对路。'
    },
    {
      title: '刻舟求剑', level: 'xia-xia',
      poem: ['刻舟求剑计偏疏', '舟已行时剑已沉', '执一不变缘何处', '坐失垂拱自茫然'],
      interpret: { home: '家泥守旧规，不随时变，宜通权达变', wealth: '财执一端求，失之已变，忌固步自封', marriage: '姻缘囿于旧念，不识已变，宜放眼新局', career: '功名守旧违时，刻舟求剑，宜应变机', health: '体执旧方调治，病已变易，宜换良方', lost: '失物刻舟求之，其迹已移,恐难寻得', travel: '行事泥于旧情，宜察其变，不可守株', lawsuit: '讼执已成之案，昧于时移，宜察其变' },
      advice: '刻舟求剑，下下。船早已开走，剑已沉远，还守着旧记号去求，注定徒劳无功。'
    },
    {
      title: '守株待兔', level: 'xia-xia',
      poem: ['守株待兔待何时', '一获偶然未可怡', '不遇辛勤经营苦', '安得常年果自奇'],
      interpret: { home: '家存侥幸，守株待兔，宜勤身戒惰', wealth: '财待偶然之获，不作实工，忌存侥幸', marriage: '姻缘待天而降，不对经营，宜及时求真', career: '功名守株待兔，不图实功，宜勤于业', health: '体守惰而养,不勤锻炼,宜勤于动', lost: '失物守株待之，徒劳罔获，宜早努力寻', travel: '行程守株待路，不事安排，宜早作备', lawsuit: '讼守株待断，不早筹谋，宜积极应对' },
      advice: '守株待兔，下下。天上是不会掉馅饼的，靠碰运气终难长久，务实勤做才是正途。'
    },
    {
      title: '南辕北辙', level: 'xia-xia',
      poem: ['南辕北辙道乖违', '愈用其力愈见非', '返错回头须及早', '方知辨向莫迟归'],
      interpret: { home: '家所行背道，今错其方，宜速反其向', wealth: '财用反其道而行，愈劳愈失，宜辨正途', marriage: '姻缘背道而行，所向殊途，宜早改弦', career: '功名所向乖方，徒劳无功，宜察其北辙', health: '体自治背医嘱，所养非道，宜就正途', lost: '失物南辕而求，方向已错，宜辨其方', travel: '行程南辕北辙，愈进愈远，宜宜早改道', lawsuit: '讼所向相反，理去愈远，宜速省回头' },
      advice: '南辕北辙，下下。方向反了还拼命加油，只会离目标越来越远，及早掉头方是上策。'
    },
    {
      title: '杯弓蛇影', level: 'xia-xia',
      poem: ['杯弓蛇影自疑惊', '妄见生迷误此生', '但得心中无结缚', '何曾影里好藏形'],
      interpret: { home: '家多疑生影，妄自惊疑，宜静其心澄怀', wealth: '财多疑而妄动，错判敌我，忌疑中生乱', marriage: '姻缘无故生疑，捕风捉影，宜以诚相待', career: '功名妄自惊扰，错失时机，宜察其真', health: '体疑病生惧，妄自惊忧，宜就医明断', lost: '失物疑其所藏，虚妄难寻，宜静而察', travel: '行程忧疑阻步，杯弓蛇影，宜坦然行', lawsuit: '讼多疑自扰，捕风捉影，宜就实查证' },
      advice: '杯弓蛇影，下下。把影子当成毒蛇，往往是自乱阵脚，先安定心神辨清真伪。'
    },
    {
      title: '作茧自缚', level: 'xia-xia',
      poem: ['作茧自缚茧成丝', '困守此身未可知', '莫自织罗缠己足', '破将茧出始为时'],
      interpret: { home: '家自设罗网，作茧自缚，宜解其自困', wealth: '财自缚于贪结，作茧招损，宜早解脱', marriage: '姻缘自困于疑，作茧难破，宜敞其怀', career: '功名自设樊笼，作茧自缚，宜撤其桎梏', health: '体自困于忧，作茧碍养，宜宽其心结', lost: '失物自缚难寻，宜破其束缚方可觅', travel: '行程自设障碍，作茧难行，宜释其结', lawsuit: '讼自陷其网，作茧难脱，宜求外解' },
      advice: '作茧自缚，下下。很多困局其实是你自己织的网，想脱身先要学会放开自己。'
    },
    {
      title: '螳臂当车', level: 'xia-xia',
      poem: ['螳臂当车不自量', '辙中扰扰总成殃', '势微欲逞终难恃', '宜审其时免自伤'],
      interpret: { home: '家小逞其强，螳臂当车，宜审势度力', wealth: '财以微力当大，不自量力，忌逞强进', marriage: '姻缘以偏促逼，螳臂当车，宜审时度势', career: '功名渺小当巨，绵力难任，宜量力而行', health: '体弱欲强擎重，螳臂当车，宜量力养身', lost: '失物微力难觅，势渺力微，恐难如愿', travel: '行程力小涉大，螳臂当车，宜审其势', lawsuit: '讼以弱敌强，螳臂当车，宜避其锋' },
      advice: '螳臂当车，下下。明明势单力薄偏要硬碰强敌，徒增损伤，先估量好自己的分量。'
    },
    {
      title: '自取其咎', level: 'xia-xia',
      poem: ['自取其咎复何尤', '祸由己作悔难收', '宜察当初微起处', '克己回心免后头'],
      interpret: { home: '家咎由自取，怨人无益，宜自省改过', wealth: '财损由自招，宜检已过，戒贪戒失误', marriage: '姻缘咎由自取，宜自反思，莫先责于人', career: '功名失利自招，宜追本溯因，谨以改之', health: '体恙出于自戕，宜自检起居，悔而改过', lost: '失物咎在自疏，宜自省其失，或可挽回', travel: '行程咎由自致，宜自反行程，及时补救', lawsuit: '讼咎由自取，宜自省理亏，知非改过' },
      advice: '自取其咎，下下。眼前的祸多是当初自己埋下的因，反省己过、及时改换方为上策。'
    }
  ];

  /**
   * 「求签」推演：从签筒里抽一支签。
   * 采用**完全独立**于整体运势与一事专断的 rng：
   *   - 稳定签：seed = mixSeeds(computePersonalSeed(profile), hashString('lottery@' + 维度锚点))
   *             → 同一人、同一维度、同一天必抽到同一支签，可复现；不影响既有任何 rng 序列。
   *   - 随机签（换个手气）：useRandom=true 时，用 Date.now() 毫秒作为新种子 new 一个 rng 再抽，
   *             每次点击都换、仅供娱乐；同样不触碰既有 rng。
   * @returns {{index,number,title,level,levelLabel,levelCls,poem,interpret,advice}}
   */
  function buildLottery(profile, period, refDate, useRandom) {
    var personalSeed = computePersonalSeed(profile);
    var periodStr = anchorString(period, refDate);
    var rng;
    if (useRandom) {
      // 随手再抽：以当前时间戳做种子，每次点击都不同
      rng = mulberry32((Date.now() ^ (Math.random() * 0x100000000)) >>> 0);
    } else {
      // 稳定签：个人种子 ⊕ 求签专属命名空间 ⊕ 维度锚点
      var seed = mixSeeds(personalSeed, hashString('lottery@' + periodStr));
      rng = mulberry32(seed);
    }
    var idx = Math.floor(rng() * LOTTERY_SIGNS.length);
    var sign = LOTTERY_SIGNS[idx];
    var lv = LOTTERY_LEVEL[sign.level] || LOTTERY_LEVEL['zhong-ping'];
    return {
      index: idx,
      number: idx + 1,
      title: sign.title,
      levelKey: sign.level,
      levelLabel: lv.label,
      levelCls: lv.cls,
      poem: sign.poem,
      interpret: sign.interpret,
      advice: sign.advice
    };
  }

  /* 答案之书：300 条口语化短句（肯定 / 否定 / 含糊 / 建议式，风格像 Magic 8-Ball 又接地气） */

  /* 第一段：既有 25 条，逐字保留 */
  var BOOK_ANSWERS = [
    '是，八九不离十，大胆去试。',
    '不是，想多了，收收心。',
    '再等等，别急着拍板。',
    '顺其自然，随它去吧。',
    '八成会成，别半途而废。',
    '有点悬，稳妥点再动。',
    '别勉强，勉强没幸福。',
    '心里的答案，其实你早有了。',
    '宜缓不宜急，缓一缓再说。',
    '大概率能行，只管往前冲。',
    '前景不错，但要看你怎么做。',
    '时机未到，再攒攒火候。',
    '朝这方向走，多半没错。',
    '换条路试试，别硬闯。',
    '会有惊喜，别紧张。',
    '别总惦记，越惦记越是它。',
    '值得一试，但留个后手。',
    '此路不通，及时转弯。',
    '能行，只是过程有点绕。',
    '先问自己一句：真想要吗？',
    '别让犹豫坏了事，定个日子就做。',
    '稳一手没坏处，别贪快。',
    '听听朋友的意见，旁观者清。',
    '现在不是好时机，改天再说。',
    '大胆点，机会不等人。',

    /* 第二段：肯定式（1-45） */
    '是，我看行，就它了。',
    '就去吧，别想太多。',
    '值得，放手一搏。',
    '能成，信一次自己。',
    '当然可以，好事一桩。',
    '妥了，放心大胆去。',
    '是个好主意，走起。',
    '没错，就这么办。',
    '可以的，别犹豫。',
    '往那边走，准没错。',
    '大有可为，别错过。',
    '宜早不宜迟，现在正好。',
    '好兆头，赶紧抓住。',
    '顺风顺水，大胆上。',
    '这事稳了，尽管努力。',
    '放心，天时地利都在你。',
    '踏实去做，结果差不了。',
    '这一程会顺，别慌。',
    '答案很明确，去追吧。',
    '放心，结果不会亏待你。',
    '走这步，准能见亮。',
    '能成事，只是要用心。',
    '是好消息，捡到宝了。',
    '绿灯亮了，放心通行。',
    '这方向挺正，坚持住。',
    '慢慢来，也会到终点。',
    '是个吉兆，别打退堂鼓。',
    '放心，会有回响的。',
    '值得等，值得做。',
    '会有好的进展，莫灰心。',
    '是天意，就顺着来。',
    '能过关，放轻松。',
    '有戏，把心揣肚子里。',
    '这步踏实，会有甜头。',
    '目标不远了，再加把劲。',
    '放心，路会越走越宽。',
    '别退，前面就是春天。',
    '会兑现的，耐心点。',
    '是福不是祸，是事躲不过。',
    '去，别让将来后悔。',
    '这交易划算，值得做。',
    '放心大胆闯，自有转机。',
    '是吉，笑得出来。',
    '能行，就当给自己一个机会。',
    '成事的底子都有了，别浪费。',

    /* 第三段：否定式（46-90） */
    '不是，别往里扎了。',
    '算了，这趟不值得。',
    '别，回头是岸。',
    '停下，方向不太对。',
    '这步是坑，绕开走。',
    '不行，趁早收手。',
    '想多了，没有那么顺。',
    '没戏，别浪费时间。',
    '不必了，到此为止。',
    '放弃它，把心腾出来。',
    '这条路堵着，换道走。',
    '别勉强了，缘分未到。',
    '不划算，这笔买卖亏。',
    '不是时候，先按兵不动。',
    '别上头，冷静一下。',
    '到此打住，别再往前。',
    '这念头放下吧，是噪音。',
    '不成，别再自我催眠。',
    '别赌，这把输面大。',
    '别期待太多，省得失望。',
    '此路难通，及早折返。',
    '别一头扎进去，有暗礁。',
    '不是那份缘，算了吧。',
    '别抱侥幸，容易翻车。',
    '眼下不宜，先搁一搁。',
    '别硬撑，撑太久伤身。',
    '这不是上策，收着点。',
    '别信那些空话，没用。',
    '不值当，别搭进去。',
    '别等了，等不来花。',
    '此计不成，换一着棋。',
    '别纠结，它配不上你的时间。',
    '别追，追不到会累。',
    '不合适，别将就。',
    '别动，现在站着最稳。',
    '没那运气，认栽这一次。',
    '别让一时火热蒙了眼。',
    '这潭水深，别再往里趟。',
    '别答应，回头必生悔。',
    '不是最佳，还有更好。',
    '别栽跟头，收着点性子。',
    '别小看，这条路不好走。',
    '别恋战，趁早抽身。',
    '不成立，重新想辙。',
    '别再耗，耗也耗不出结果。',

    /* 第四段：含糊 / 中庸式（91-135） */
    '看情况，见招拆招吧。',
    '再等等，火候还没到。',
    '随缘吧，强求不来。',
    '一半一半，走一步算一步。',
    '说不准，看你怎么开局。',
    '时机未熟，再捂一捂。',
    '时好时坏，平常心待之。',
    '看眼下，先稳一稳再说。',
    '难讲，得看天时。',
    '缓一缓，慌则出错。',
    '看造化，急也急不来。',
    '等等看，风向会变的。',
    '摸着石头过河，慢点没事。',
    '看状态，状态好就顺。',
    '不好不坏，中规中矩。',
    '先探探路，再决定深浅。',
    '走一步看一步，别押太大。',
    '是福是祸，试过才知。',
    '看心情，心情顺就顺。',
    '模棱两可，且信一半。',
    '看未来的风，先按兵。',
    '可进可退，留个余地。',
    '看投入，投入多少收获几何。',
    '天平微晃，稍安勿躁。',
    '时机未到，别急着亮牌。',
    '似有似无，靠运气搭把手。',
    '看缘分，别硬凑。',
    '半信半疑，走着瞧。',
    '看天吃饭，努力也别停。',
    '先看几天，别急于定论。',
    '万变不离，稳住基本盘。',
    '看局面，别先下结论。',
    '是雾是晴，天亮自然见。',
    '看你的决心有多重。',
    '中庸之道，不偏不倚。',
    '随波不逐流，走走看。',
    '看时机，也看心情。',
    '含糊其辞，其实是还没定。',
    '看细节，细节藏着答案。',
    '两可之间，别太较真。',
    '看时运，也看你的脚步。',
    '看平衡，别让一边倒。',
    '静观其变，别贸然出手。',
    '看开头就知道结局。',
    '不置可否，且放着。',

    /* 第五段：建议 / 反问式（136-180） */
    '问问你的直觉，它怎么说？',
    '要不先睡一觉，醒来再算？',
    '听听过来人的话，错不了。',
    '先列个清单，再决定。',
    '问问镜子里的自己信不信。',
    '给自己留条后路，别一把梭哈。',
    '多听少说，先看清局势。',
    '把最坏打算想好，就敢了。',
    '先踏实做小事，大事自然明。',
    '把手机放下，答案就在心里。',
    '换个角度看看，是不是想窄了？',
    '先深呼吸，再回答我。',
    '找人摊开聊，别憋着。',
    '把日子过踏实，答案自会来。',
    '别忙着答，先问问为什么。',
    '先观察，再下注。',
    '把期望调低点，惊喜就多了。',
    '问问此刻的天气，天在给提示。',
    '先把手头这步走好。',
    '列个利弊，一目了然。',
    '先照顾好自己，别的都会好。',
    '别只看眼前，往长里想。',
    '先问值不值，再问能不能。',
    '把心放平，答案才浮出来。',
    '先行动一小步，看看反应。',
    '听听你身体怎么说，它最诚实。',
    '先定个小目标，别想太远。',
    '把它写下来，丢给明天。',
    '先分清主次，别眉毛胡子一把抓。',
    '问问信任的人，别自己钻牛角尖。',
    '先跨出第一步，路就出来了。',
    '把目标说出口，就成了一半。',
    '先检查是不是想太多了。',
    '问问昨天的自己怎么选。',
    '别急着表白，先送朵花谈谈。',
    '先算算得失，再开口。',
    '把心力留给自己，别外耗。',
    '先站稳了，再想跨越。',
    '先打理好心情，运势自然好。',
    '问一句：这是你真心要的吗？',
    '先做再说，别光想不动。',
    '把节奏放慢，认真看路。',
    '先解决眼下，再操心以后。',
    '问问风往哪边吹，顺势走。',
    '先记账，钱花哪了得明白。',

    /* 第六段：混合补充（181-275） */
    '是，别辜负了这一腔热。',
    '不是，这份煎熬没人替。',
    '再放一放，气顺了再做。',
    '顺着心意来，心就告诉你路。',
    '八成稳，只管把事做漂亮。',
    '有点险，先探探深浅。',
    '别硬来，硬来的都不甜。',
    '问过心，答案就在那儿亮着。',
    '宜周全，先谋定而后动。',
    '十有八九成，把细节抠到位。',
    '后天不错，就长远了看。',
    '时候未到，先积攒底气。',
    '这分明是条对路，别下坡。',
    '换个法子，路就通了一半。',
    '有意外之喜，别绷太紧。',
    '别念念不忘，忘了更轻松。',
    '值得投入，搭进去也甘愿。',
    '此路难走，但最值当。',
    '能成，就是绕点远，也值。',
    '再想想，这事值你几个凌晨。',
    '别磨蹭到错过，定了就走。',
    '稳住别飘，稳才走得远。',
    '旁观者清，先听两句再定。',
    '此刻不宜，过了风头再说。',
    '胆子大点，人生才够劲儿。',
    '这步踩实了，往上是迟早事。',
    '别怕慢，慢到就是快。',
    '有天赐的运气，剩看你自己。',
    '宜欢庆，别辜负好光景。',
    '要来的挡不住，坦然接着。',
    '这条路光好，只管往前趟。',
    '别捡芝麻，要回来捡西瓜。',
    '一试便知，反正试错也便宜。',
    '别把话说死，留三分和气。',
    '值得一搏，纵输也无憾。',
    '此局有转，须耐下性子。',
    '能圆，只是少个点火的人。',
    '先问一句，你能接受最坏吗？',
    '别攒着不上，攒多了更慌。',
    '稳扎稳打，甜头留给有耐心的人。',
    '听听你妈说，妈妈看的远。',
    '现在别动，端着是福。',
    '要有点魄力，别窝着不动。',
    '放心，守得云开见月明。',
    '别贪多，贪多嚼不烂。',
    '这趟会有收获，别嫌小。',
    '不是对手难，是你底气虚。',
    '再沉住气，火候到汤才鲜。',
    '顺着光走，别瞎摸索。',
    '别计较一时得失，放长线。',
    '会翻篇的，日子往前过。',
    '宜结伴，一个人走太冷清。',
    '别憋大招，先亮小招探探。',
    '这决定有点赌，先备好后路。',
    '能行，只是要先低下头。',
    '别急着证明，赢了才算数。',
    '问心无悔，就是最好的答案。',
    '先照顾好身体，一切才有得谈。',
    '别跟人比，各人有各人的铃铛。',
    '是甜的，别被开头苦吓退。',
    '不是空，是时机还没敲对门。',
    '慢慢熬，熬出香就是好日子。',
    '看天色行事，别逆着风走。',
    '就这个，别再三心二意。',
    '别贪快，快里的都是虚的。',
    '有点吵，先静下来听自己。',
    '放下吧，背着太沉走不远。',
    '值得，这是往心上浇水。',
    '此路有亮，就是坡陡了些。',
    '能抵岸，且把手里的舵握稳。',
    '先跟自己和解，再谈其他。',
    '别慌，慌容易走错三步。',
    '稳着来，结果会替你说话。',
    '听点劝，别栽在自己手上。',
    '此刻宜休整，别急着赶路。',
    '胆大心细，好运气爱咬胆大的。',
    '这步有漏，先补补功课。',
    '会有回声，别一个人唱独角。',
    '别较劲，较劲的小事最费神。',
    '是好事，福气喜欢扎堆来。',
    '不是无路，是你还没侧身。',
    '再蓄蓄劲，发出去才有力。',
    '顺应天时，别跟它对着干。',
    '就一路向北，别再回头。',
    '别省那一步，省了要绕远。',
    '能成，笑着把这仗打完。',
    '别急着抢跑，均匀呼吸最稳。',
    '先把盘子端平，再管甜不甜。',
    '听老人言，吃亏在眼前是瞎话。',
    '此刻宜简，别把日子弄复杂。',
    '慢慢来，比较快。',
    '就信这一回，错也认了。',
    '不值得，趁早把情绪放行。',
    '是时候了，水到渠自成。',
    '不是时机，是差半分火候。',
  ];

  /**
   * 「答案之书」：每次翻开都随机给一句答案。
   * 答案之书本性就是「随手翻」，因此在打开时用 Math.random 直接从答案池取 / 或在稳定种子基础上
   * 用 Date.now() 叠加以保证每次点击都出新结果，不会显得僵化。与整体运势的 rng 完全无关。
   * @param {object} profile 仅在需要稳定发散时用的个人种子（默认不依赖，保持自然随机）
   * @returns {{answer:string, question:string}}
   */
  function openBook(question, profile) {
    var ans;
    var last = openBookLastAns || null;
    for (var tries = 0; tries < 5; tries++) {
      ans = BOOK_ANSWERS[Math.floor(Math.random() * BOOK_ANSWERS.length)];
      if (ans !== last) break;   // 避免连续两次一模一样，显得太僵
    }
    openBookLastAns = ans;
    return { answer: ans, question: (question || '').trim() };
  }
  var openBookLastAns = null;

  /* 时间维度中文标签 + 日期范围 */
  function periodLabel(period, d) {
    var lbl = { day: '今日', week: '本周', month: '本月', year: '今年' };
    return lbl[period] || '今日';
  }
  function dateLabel(period, d) {
    function fmt(x) { return x; }
    if (period === 'day') return fmt(d.getMonth() + 1) + '月' + fmt(d.getDate()) + '日';
    if (period === 'week') {
      var dow = (d.getDay() + 6) % 7;
      var mon = new Date(d); mon.setDate(d.getDate() - dow);
      var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return fmt(mon.getMonth() + 1) + '.' + fmt(mon.getDate()) + ' - ' + fmt(sun.getMonth() + 1) + '.' + fmt(sun.getDate());
    }
    if (period === 'month') return d.getFullYear() + '年' + fmt(d.getMonth() + 1) + '月';
    return d.getFullYear() + ' 全年';
  }
  /* 紧凑日期范围（用于页签辅助小字与概览卡周期标题）：day 8/14、week 8/10-8/16、month 2026/8、year 2026 */
  function shortDate(period, d) {
    var dt = d ? new Date(d) : new Date();
    function f(x) { return x; }
    if (period === 'day') return f(dt.getMonth() + 1) + '/' + f(dt.getDate());
    if (period === 'week') {
      var dow = (dt.getDay() + 6) % 7;
      var mon = new Date(dt); mon.setDate(dt.getDate() - dow);
      var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return f(mon.getMonth() + 1) + '/' + f(mon.getDate()) + '-' + f(sun.getMonth() + 1) + '/' + f(sun.getDate());
    }
    if (period === 'month') return dt.getFullYear() + '/' + f(dt.getMonth() + 1);
    return '' + dt.getFullYear();
  }

  /* ======================== 四、输入解析 ======================== */

  /**
   * 解析表单输入为结构化 profile。
   * 兼容只填部分资料；只要给了公历生日，即可推演出基础运势。
   */
  function parseProfile(form) {
    var profile = {};

    profile.name = form.name.value.trim();
    profile.gender = form.gender.value;

    var birthDate = form.birthDate.value; // yyyy-mm-dd
    var hourRaw = form.birthHour.value;    // 空或数字字符串
    profile.constellation = form.constellation.value;
    profile.blood = form.blood.value;
    profile.mbti = form.mbti.value;
    profile.birthPlace = form.birthPlace.value; // 出生地城市键（空 = 未填）

    // 星座未填时按公历生日自动推断
    if (!profile.constellation && birthDate) {
      profile.constellation = autoConstellation(birthDate);
    }

    if (birthDate) {
      var parts = birthDate.split('-');
      var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), dd = parseInt(parts[2], 10);
      profile.birthKey = y + '-' + m + '-' + dd + '@' + (hourRaw || 'x');
      profile.birthYear = y;

      // 生日派生日干支 / 日干五行
      var gz = getDayGanzhi(y, m, dd);
      profile.dayGanIndex = gz.ganIndex;
      profile.dayZhiIndex = gz.zhiIndex;
      profile.dayGanChar = gz.ganChar;
      profile.dayZhiChar = gz.zhiChar;
      profile.dayGanzhi = gz.ganzhi;

      // 梅花卦数：年月日之和
      profile.moneyHex = (y + m + dd) % 8;

      // 是否提供了出生时辰（用于紫微）
      profile.hourProvided = !!hourRaw;
      profile.hourZhi = hourRaw ? HOUR_ZHI[hourRaw] : null;
    }

    return profile;
  }

  /**
   * 依据公历月/日推算星座。
   * 采用「年内第几天」区间法：每个星座对应一个 [startIdx, endIdx] 的 day-of-year 区间，
   * 摩羯座跨年，故拆成开年段 [1,19] 与年末段 [356,365] 两个区间。
   */
  function autoConstellation(dateStr) {
    var parts = dateStr.split('-');
    var m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    var idx = dayOfYear(m, d); // 当年第几天（平年），下标 1 起

    // 星座 day-of-year 区间（平年，非闰年：2/29 仅影响闰年，差一天属边界极小概率，忽略）
    var ranges = [
      { key: 'capricorn', start: 1,   end: 19   },  // 摩羯（开年段）
      { key: 'aquarius',  start: 20,  end: 49   },
      { key: 'pisces',    start: 50,  end: 79   },
      { key: 'aries',     start: 80,  end: 109  },
      { key: 'taurus',    start: 110, end: 140  },
      { key: 'gemini',    start: 141, end: 172  },
      { key: 'cancer',    start: 173, end: 203  },
      { key: 'leo',       start: 204, end: 234  },
      { key: 'virgo',     start: 235, end: 265  },
      { key: 'libra',     start: 266, end: 295  },
      { key: 'scorpio',   start: 296, end: 325  },
      { key: 'sagittarius', start: 326, end: 355 },
      { key: 'capricorn', start: 356, end: 365  }   // 摩羯（年末段 12/22-12/31）
    ];

    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (idx >= r.start && idx <= r.end) return r.key;
    }
    return 'capricorn'; // 兜底
  }

  /** 把（月,日）换算成一年内的第几天（平年 365 天，下标 1 起） */
  function dayOfYear(mon, day) {
    var dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var t = 0;
    for (var i = 0; i < mon - 1; i++) t += dim[i];
    return t + day;
  }

  /* ======================== 五、界面渲染 ======================== */

  function init() {
    var form = document.getElementById('fortune-form');
    var resultPanel = document.getElementById('result-panel');
    var btnReset = document.getElementById('btn-reset');

    var latest = null;       // 最近一次为 4 个维度生成的结果
    var latestProfile = null; // 最近一次解析得到的个人资料（供求签/答案之书复用稳定种子）
    var currentPeriod = 'day';
    var activeRef = new Date();

    // 「一事专断」：用户填的具体事项（文本 + 分类 + 各维度结果）
    var matterInput = { text: '', category: 'other' };
    var matterResults = null; // { day, week, month, year } 各维度事项运势

    // 保存到全局，供渲染函数使用
    var _ref = { v: null };

    /* ---- 提交：生成四维度数据并展示 ---- */
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var profile = parseProfile(form);
      latestProfile = profile; // 保留最近一次资料，供求签 / 答案之书复用个人稳定种子

      // 未填生日时提示
      if (!profile.birthKey) {
        alert('请至少填写出生日期（公历），以便进行基础推演。');
        return;
      }

      // 读取「一事专断」输入（分类下拉 + 自由文本，二者取其一即可，均可留空）
      var categoryField = document.getElementById('matter-category');
      var textField = document.getElementById('matter-text');
      var categoryKey = categoryField ? categoryField.value : 'other';
      var matterText = textField ? textField.value.trim() : '';
      // 只选了分类没写具体事项时，用分类名充当事项主体
      var effectiveText = matterText || (categoryKey !== 'other' ? categoryKeyLabel(categoryKey) : '');
      var hasMatter = !!effectiveText && (categoryKey !== '');
      matterInput = { text: matterText, category: categoryKey };
      matterResults = hasMatter
        ? {
            day: buildMatterFortune(profile, effectiveText, categoryKey, 'day', activeRef),
            week: buildMatterFortune(profile, effectiveText, categoryKey, 'week', activeRef),
            month: buildMatterFortune(profile, effectiveText, categoryKey, 'month', activeRef),
            year: buildMatterFortune(profile, effectiveText, categoryKey, 'year', activeRef)
          }
        : null;

      latest = {
        day: buildFortune(profile, 'day', activeRef),
        week: buildFortune(profile, 'week', activeRef),
        month: buildFortune(profile, 'month', activeRef),
        year: buildFortune(profile, 'year', activeRef)
      };
      _ref.v = latest;
      currentPeriod = 'day';

      resultPanel.hidden = false;
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      syncTabs('day');
      render('day');
    });

    /* ---- 清空 ---- */
    btnReset.addEventListener('click', function () {
      form.reset();
      matterResults = null;
      matterInput = { text: '', category: 'other' };
      var matterBox = document.getElementById('matter-card');
      if (matterBox) { matterBox.classList.add('hidden'); matterBox.innerHTML = ''; }
      // MBTI 人格视角卡同样隐藏归位（重新推演时由 render 流程按新资料重渲）
      var mbtiBox = document.getElementById('mbti-card');
      if (mbtiBox) { mbtiBox.hidden = true; mbtiBox.classList.add('hidden'); mbtiBox.innerHTML = ''; }
      resultPanel.hidden = true;
      syncYearBtns(); // 表单重置后按默认基准刷新年份按钮状态
      closeBirthDatePicker(); // 表单重置后关闭自绘日历弹层
    });

    /* ---- 出生日期 · 年份前后调节（◀ 上一年 / ▶ 下一年） ---- */
    var birthDateInput = document.getElementById('birth-date');
    var yearPrevBtn = document.getElementById('year-prev');
    var yearNextBtn = document.getElementById('year-next');
    var YEAR_MIN = 1900;                 // 年份下限
    var YEAR_DEFAULT_BASE = { y: 2000, m: 1, d: 1 }; // 生日为空时的默认基准（YYYY-01-01）

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

    /* 取当前（或空值默认基准的）年月日 */
    function getBirthBase() {
      if (birthDateInput && birthDateInput.value) {
        var p = birthDateInput.value.split('-');
        return { y: parseInt(p[0], 10), m: parseInt(p[1], 10), d: parseInt(p[2], 10) };
      }
      return { y: YEAR_DEFAULT_BASE.y, m: YEAR_DEFAULT_BASE.m, d: YEAR_DEFAULT_BASE.d };
    }

    /* 按当前年份同步两枚按钮的可用状态（越界即禁用） */
    function syncYearBtns() {
      var y = getBirthBase().y;
      var maxY = new Date().getFullYear();
      if (yearPrevBtn) yearPrevBtn.disabled = y <= YEAR_MIN;
      if (yearNextBtn) yearNextBtn.disabled = y >= maxY;
    }

    function shiftBirthYear(delta) {
      if (!birthDateInput) return;
      var base = getBirthBase();
      var ny = base.y + delta;
      /* 超出 [1900, 当前年份] 直接不生效 */
      if (ny < YEAR_MIN || ny > new Date().getFullYear()) return;
      var nm = base.m, nd = base.d;
      /* 2月29日 → 非闰年降级为 2月28日 */
      if (nm === 2 && nd === 29 && !isLeapYear(ny)) nd = 28;
      birthDateInput.value = ny + '-' + pad2(nm) + '-' + pad2(nd);
      /* 与现有表单逻辑保持一致：触发 change */
      birthDateInput.dispatchEvent(new Event('change', { bubbles: true }));
      syncYearBtns();
    }

    if (yearPrevBtn) yearPrevBtn.addEventListener('click', function () { shiftBirthYear(-1); });
    if (yearNextBtn) yearNextBtn.addEventListener('click', function () { shiftBirthYear(1); });
    if (birthDateInput) birthDateInput.addEventListener('change', syncYearBtns);
    syncYearBtns();

    /* ---- 出生日期 · 自绘日历弹层（替代浏览器原生 date 弹层，日期栏放大） ---- */
    var birthDatePop = document.getElementById('birth-date-pop');
    var popView = { y: YEAR_DEFAULT_BASE.y, m: YEAR_DEFAULT_BASE.m }; // 弹层当前展示的年月
    var DPP_WEEKS = ['日', '一', '二', '三', '四', '五', '六'];

    function closeBirthDatePicker() {
      if (birthDatePop) birthDatePop.hidden = true;
    }

    function birthDatePopIsOpen() {
      return !!(birthDatePop && !birthDatePop.hidden);
    }

    function renderBirthDatePicker() {
      if (!birthDatePop) return;
      var y = popView.y, m = popView.m;
      var today = new Date();
      var todayStr = today.getFullYear() + '-' + pad2(today.getMonth() + 1) + '-' + pad2(today.getDate());
      var selStr = (birthDateInput && birthDateInput.value) ? birthDateInput.value : '';

      var html = '';
      html += '<div class="dpp-head">';
      html += '<button type="button" class="dpp-nav dpp-y-prev" aria-label="上一年" title="上一年">«</button>';
      html += '<button type="button" class="dpp-nav dpp-m-prev" aria-label="上一月" title="上一月">◀</button>';
      html += '<div class="dpp-title">' + y + '年' + m + '月</div>';
      html += '<button type="button" class="dpp-nav dpp-m-next" aria-label="下一月" title="下一月">▶</button>';
      html += '<button type="button" class="dpp-nav dpp-y-next" aria-label="下一年" title="下一年">»</button>';
      html += '</div>';
      html += '<div class="dpp-week">';
      for (var w = 0; w < 7; w++) html += '<span>' + DPP_WEEKS[w] + '</span>';
      html += '</div>';

      /* 当月 1 号的星期 + 当月天数 → 动态行数（5 或 6 行，覆盖当月最后一天即可） */
      var firstDay = new Date(y, m - 1, 1).getDay();
      var daysInMonth = new Date(y, m, 0).getDate();
      var totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

      html += '<div class="dpp-grid">';
      for (var i = 0; i < totalCells; i++) {
        /* 当月 1 号之前的跨月补位格：空白占位（无数字、不可点、无 hover） */
        if (i < firstDay) {
          html += '<span class="dpp-day dpp-blank" aria-hidden="true"></span>';
          continue;
        }
        var dayNum = i - firstDay + 1;
        var ds = y + '-' + pad2(m) + '-' + pad2(dayNum);
        var cls = 'dpp-day';
        if (ds === todayStr) cls += ' dpp-today';
        if (ds === selStr) cls += ' dpp-sel';
        html += '<button type="button" class="' + cls + '" data-date="' + ds + '">' + dayNum + '</button>';
      }
      html += '</div>';
      birthDatePop.innerHTML = html;
    }

    function openBirthDatePicker() {
      if (!birthDatePop || !birthDateInput) return;
      var base = getBirthBase(); // 空值默认 2000-01，与年份调节基准一致
      popView.y = base.y;
      popView.m = base.m;
      renderBirthDatePicker();
      birthDatePop.hidden = false;
    }

    /* 年/月快捷翻页（年份下限与 YEAR_MIN 一致） */
    function shiftPopView(yearDelta, monthDelta) {
      var total = popView.y * 12 + (popView.m - 1) + yearDelta * 12 + monthDelta;
      var ny = Math.floor(total / 12);
      var nm = total % 12 + 1;
      if (ny < YEAR_MIN) { ny = YEAR_MIN; nm = 1; }
      popView.y = ny;
      popView.m = nm;
      renderBirthDatePicker();
    }

    /* 弹层内点击：导航按钮翻页 / 点选日期写回 input（事件委托） */
    if (birthDatePop) {
      birthDatePop.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('dpp-nav')) {
          if (t.classList.contains('dpp-y-prev')) shiftPopView(-1, 0);
          else if (t.classList.contains('dpp-y-next')) shiftPopView(1, 0);
          else if (t.classList.contains('dpp-m-prev')) shiftPopView(0, -1);
          else if (t.classList.contains('dpp-m-next')) shiftPopView(0, 1);
          return;
        }
        if (t.classList.contains('dpp-day')) {
          birthDateInput.value = t.getAttribute('data-date');
          /* 与现有表单逻辑保持一致：触发 change（年份按钮/解析逻辑依赖它） */
          birthDateInput.dispatchEvent(new Event('change', { bubbles: true }));
          closeBirthDatePicker();
        }
      });
    }

    /* 聚焦输入框：打开弹层；并记录当前值（blur 校验失败时回退用） */
    var lastValidBirth = '';
    if (birthDateInput) {
      birthDateInput.addEventListener('focus', function () {
        lastValidBirth = birthDateInput.value;
        openBirthDatePicker();
      });
      /* 失焦校验：非空值须匹配 YYYY-MM-DD、真实合法日期（2月/闰年、大小月由 Date 自动判定）、
         年份在 [1900, 当前年份]；合法 → 规范化写回并触发 change；不合法或为空 → 回退 focus 时记录的值 */
      birthDateInput.addEventListener('blur', function () {
        var v = birthDateInput.value;
        var ok = false, y = 0, m = 0, d = 0;
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          y = parseInt(v.slice(0, 4), 10);
          m = parseInt(v.slice(5, 7), 10);
          d = parseInt(v.slice(8, 10), 10);
          var dim = new Date(y, m, 0).getDate();
          ok = m >= 1 && m <= 12 && d >= 1 && d <= dim
            && y >= YEAR_MIN && y <= new Date().getFullYear();
        }
        if (ok) {
          birthDateInput.value = y + '-' + pad2(m) + '-' + pad2(d);
          birthDateInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          birthDateInput.value = lastValidBirth;
        }
      });
      /* value 变化（年份调节按钮写回等）时，若弹层开着则刷新显示 */
      birthDateInput.addEventListener('change', function () {
        if (birthDatePopIsOpen()) {
          var base = getBirthBase();
          popView.y = base.y;
          popView.m = base.m;
          renderBirthDatePicker();
        }
      });
    }

    /* 点击弹层与输入框以外区域关闭弹层 */
    document.addEventListener('click', function (e) {
      if (!birthDatePopIsOpen()) return;
      if (e.target === birthDateInput || (birthDatePop && birthDatePop.contains(e.target))) return;
      /* 年份调节按钮不视为外部点击：弹层保持打开，change 后自动刷新到新年份 */
      if (yearPrevBtn && yearPrevBtn.contains(e.target)) return;
      if (yearNextBtn && yearNextBtn.contains(e.target)) return;
      closeBirthDatePicker();
    });

    /* ---- 维度页签切换 ---- */
    var tabs = document.querySelectorAll('.tab');

    /* 页面加载即用当日日期填充各页签的 tab-date 辅助小字（每天打开都正确） */
    function syncTabDates() {
      var now = new Date();
      tabs.forEach(function (tab) {
        var span = tab.querySelector('.tab-date');
        if (span) span.textContent = shortDate(tab.getAttribute('data-period'), now);
      });
    }
    syncTabDates();
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var period = tab.getAttribute('data-period');
        currentPeriod = period;
        if (_ref.v) render(period);
        syncTabs(period);
        // 与求签维度联动：页签切换时同步求签下拉
        var lp = document.getElementById('lottery-period');
        if (lp) lp.value = period;
      });
    });

    /* ---- 求签维度下拉：改动时同步顶部页签高亮 ---- */
    var lotteryPeriodSel = document.getElementById('lottery-period');
    if (lotteryPeriodSel) {
      lotteryPeriodSel.addEventListener('change', function () {
        currentPeriod = lotteryPeriodSel.value;
        if (_ref.v) render(currentPeriod);
        syncTabs(currentPeriod);
      });
    }

    /* ---- 求签：稳定签 + 随手再抽 ---- */
    var btnLottery = document.getElementById('btn-lottery');
    var btnLotteryRandom = document.getElementById('btn-lottery-random');
    function renderLottery(useRandom) {
      var period = LOTTERY_PERIOD(); // 由下拉取当前求签维度
      var profile = latestProfile || parseProfile(form); // 未提交运势也可用当前表单资料
      var sign = buildLottery(profile, period, new Date(), useRandom);
      var card = document.getElementById('sign-card');
      card.classList.remove('hidden');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      card.innerHTML = renderSignCard(sign, period);
    }

    /**
     * 渲染寺庙灵签式的签文卡片。
     * 结构对标知名寺庙灵签：签号 + 等级 → 古典签题 → 签诗 → 「签文解析」八项 → 白话点睛。
     */
    function renderSignCard(sign, period) {
      // 八项签文解析（字段与 LOTTERY_SIGNS.interpret 对齐，标签取寺庙灵签惯用称呼）
      var keys = [
        { k: 'home',    label: '家宅' },
        { k: 'wealth',  label: '求财' },
        { k: 'marriage',label: '婚姻' },
        { k: 'career',  label: '功名' },
        { k: 'health',  label: '疾病' },
        { k: 'lost',    label: '失物' },
        { k: 'travel',  label: '行人' },
        { k: 'lawsuit', label: '诉讼' }
      ];
      var interpret = sign.interpret || {};
      var items = keys.map(function (it) {
        var val = interpret[it.k] || '—';
        return '<dt>' + it.label + '</dt><dd>' + val + '</dd>';
      }).join('');
      var poemHtml = sign.poem.map(function (l) { return '<span>' + l + '</span>'; }).join('');
      return '' +
        '<div class="sign-stick" aria-hidden="true">🎋</div>' +
        '<div class="sign-body">' +
          '<div class="sign-head">' +
            '<span class="sign-no">第 ' + sign.number + ' 签</span>' +
            '<span class="level-pill ' + sign.levelCls + '">' + sign.levelLabel + '</span>' +
          '</div>' +
          '<h3 class="sign-title">' + sign.title + '</h3>' +
          '<span class="sign-period">' + periodLabel(period, new Date()) + ' · 求签</span>' +
          '<p class="sign-poem">' + poemHtml + '</p>' +
          '<div class="sign-interpret">' +
            '<h4 class="sign-interpret-title">签文解析</h4>' +
            '<dl class="sign-interpret-list">' + items + '</dl>' +
          '</div>' +
          '<p class="sign-advice">白话点睛 · ' + sign.advice + '</p>' +
        '</div>';
    }
    // 当前求签维度：优先下拉，其次当前选中页签
    function LOTTERY_PERIOD() {
      var el = document.getElementById('lottery-period');
      return (el && el.value) ? el.value : currentPeriod;
    }
    if (btnLottery) btnLottery.addEventListener('click', function () { renderLottery(false); });
    if (btnLotteryRandom) btnLotteryRandom.addEventListener('click', function () { renderLottery(true); });

    /* ---- 答案之书：每次翻都出新答案 ---- */
    var btnBook = document.getElementById('btn-book');
    if (btnBook) {
      btnBook.addEventListener('click', function () {
        var qField = document.getElementById('book-question');
        var question = qField ? qField.value : '';
        var res = openBook(question, latestProfile || parseProfile(form));
        var card = document.getElementById('book-card');
        card.classList.remove('hidden');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        var qHtml = (res.question ? '<p class="book-question">你的问题：' + escapeHtml(res.question) + '</p>' : '');
        card.innerHTML =
          '<div class="book-open" aria-hidden="true">📖</div>' +
          '<div class="book-body">' +
            qHtml +
            '<p class="book-answer">' + res.answer + '</p>' +
          '</div>';
      });
    }

    /* 轻量转义，防止用户输入注入 HTML */
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    /* ---- 维度切换高亮同步 ---- */
    function syncTabs(period) {
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-period') === period;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.getElementById('period-label').textContent =
        (_ref.v ? _ref.v[period].periodLabel : periodLabel(period, new Date())) +
        ' ' + shortDate(period);
    }

    /* ---- 渲染「MBTI 人格视角」卡片（未填 MBTI 时隐藏；不触碰整体推演 rng） ---- */
    function renderMbtiCard(profile, f, period) {
      var card = document.getElementById('mbti-card');
      if (!card) return;
      var mbtiType = profile && profile.mbti ? profile.mbti : '';
      // 未填 MBTI 或非法值：保持隐藏，结果与未启用此卡时完全一致
      if (!mbtiType || !MBTI_MOD[mbtiType]) {
        card.hidden = true;
        card.classList.add('hidden');
        card.innerHTML = '';
        return;
      }
      var pf = MBTI_PROFILE[mbtiType] || { name: mbtiType, keywords: [] };
      var mod = MBTI_MOD[mbtiType];

      // 主导倾向：四维中数值最大者（只读静态表数值，确定性比较，不耗任何随机数）
      var domKey = 'stable';
      var domVal = -1;
      ['adv', 'stable', 'social', 'inner'].forEach(function (k) {
        var v = typeof mod[k] === 'number' ? mod[k] : 0;
        if (v > domVal) { domVal = v; domKey = k; }
      });

      // 专属建议：1 条「主导倾向 × 运势等级」确定性映射文案 + 最多 2 条倾向小贴士。
      // 小贴士用独立 'mbti@' 命名空间种子选取（参照 lottery@ 隔离模式），
      // 与 computeFortune / 一事专断 / 求签 / 答案之书的随机序列互不影响。
      var advicePool = MBTI_TIPS[domKey] || [];
      var extra = [];
      if (advicePool.length) {
        var periodAnchor = anchorString(period, activeRef);
        var mbtiSeed = mixSeeds(hashString('mbti@' + mbtiType + '@' + domKey), hashString(periodAnchor));
        var mrng = mulberry32(mbtiSeed);
        extra = pickN(mrng, advicePool, 2);
      }
      var mainAdvice = (MBTI_ADVICE[domKey] && MBTI_ADVICE[domKey][f.levelKey]) || '';
      var items = [];
      if (mainAdvice) items.push(mainAdvice);
      items = items.concat(extra);

      // 注入内容全部来自静态文案表（类型代码也来自固定下拉项），无用户输入，防注入
      var keywordHtml = (pf.keywords || []).map(function (k) {
        return '<span class="mbti-keyword">' + k + '</span>';
      }).join('');
      var listHtml = items.map(function (s) { return '<li>' + s + '</li>'; }).join('');

      card.hidden = false;
      card.classList.remove('hidden');
      card.innerHTML =
        '<div class="mbti-head">' +
          '<span class="mbti-badge">' + mbtiType + '</span>' +
          '<div class="mbti-title">' +
            '<span class="mbti-tag">MBTI 人格视角</span>' +
            '<h4 class="mbti-name">' + pf.name + '</h4>' +
          '</div>' +
          '<span class="mbti-dom">主导倾向 · ' + MBTI_DIM_LABEL[domKey] + '</span>' +
        '</div>' +
        '<div class="mbti-keywords">' + keywordHtml + '</div>' +
        '<div class="mbti-advice-block">' +
          '<h4 class="mbti-advice-title">人格 × ' + f.periodLabel + '运势（' + f.levelText + '）</h4>' +
          '<ul class="mbti-advice-list">' + listHtml + '</ul>' +
        '</div>';
    }

    /* ---- 渲染「一事专断」卡片（当前维度） ---- */
    function renderMatter(period) {
      var box = document.getElementById('matter-card');
      if (!box) return;
      // 卡片为空壳占位：无具体事项时隐藏
      if (!matterResults) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
      }
      var m = matterResults[period];
      if (!m) { box.classList.add('hidden'); box.innerHTML = ''; return; }

      box.classList.remove('hidden');
      box.innerHTML =
        '<div class="matter-head">' +
          '<div class="matter-title">' +
            '<span class="matter-icon">' + m.categoryIcon + '</span>' +
            '<div>' +
              '<span class="matter-tag">' + m.categoryLabel + ' · 一事专断</span>' +
              '<h4 class="matter-question">「' + escapeHtml(m.matterText) + '」</h4>' +
            '</div>' +
          '</div>' +
          '<div class="matter-grade">' +
            '<span class="level-pill ' + m.levelKey + '">' + m.levelText + '</span>' +
            '<span class="matter-score-block"><b class="matter-score">' + m.score + '</b><em class="matter-score-label">专属指数</em></span>' +
          '</div>' +
        '</div>' +
        '<p class="matter-summary">' + m.summary + '</p>' +
        '<p class="matter-tendency">' + m.tendency + '</p>' +
        '<div class="cards-row matter-lists">' +
          '<div class="card good-card">' +
            '<h3 class="card-title">宜 · 此事宜做</h3>' +
            '<ul class="do-list">' + m.dos.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
          '</div>' +
          '<div class="card avoid-card">' +
            '<h3 class="card-title">忌 · 此事忌做</h3>' +
            '<ul class="avoid-list">' + m.avo.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
          '</div>' +
        '</div>';
    }

    /* ---- 渲染单个维度 ---- */
    function render(period) {
      var f = _ref.v[period];
      if (!f) return;

      // 一事专断卡片（整体运势之上，先渲染）
      renderMatter(period);

      // MBTI 人格视角卡（概览卡之后；未填 MBTI 时自动隐藏；四个维度切换时随之刷新）
      renderMbtiCard(latestProfile, f, period);

      // 仪表盘分数
      document.getElementById('gauge-score').textContent = f.score;
      var path = document.getElementById('gauge-path');
      var circumference = 326.7; // 2*PI*52
      var offset = circumference * (1 - f.score / 100);
      path.setAttribute('stroke-dashoffset', offset);
      // 根据等级换色
      var gradeColor = {
        'ji': '#ffd27a', 'zhong-ji': '#8fd0a8',
        'ping': '#d8b672', 'xiong': '#e08a7a', 'da-xiong': '#e2634f'
      };
      path.setAttribute('stroke', gradeColor[f.levelKey] || '#d8b672');

      // 等级
      var pill = document.getElementById('level-pill');
      pill.textContent = f.levelText;
      pill.className = 'level-pill ' + f.levelKey;

      // 幸运
      document.getElementById('lucky-color').textContent = f.luckyColor;
      document.getElementById('lucky-number').textContent = f.luckyNumber;
      document.getElementById('period-ganzhi').textContent = f.ganzhi + ' · ' + f.dateLabel;

      // 出生地（填了才展示：城市名 + 方位五行，如「北京（北方 · 水）」）
      var placeWrap = document.getElementById('ov-birthplace-wrap');
      var placeEl = document.getElementById('ov-birthplace');
      if (placeWrap && placeEl) {
        if (f.birthPlaceLabel) {
          placeEl.textContent = f.birthPlaceLabel;
          placeWrap.hidden = false;
        } else {
          placeWrap.hidden = true;
        }
      }

      // 星级（0-5）
      var starBox = document.getElementById('ov-star');
      var starsHtml = '';
      var starCount = Math.round(f.score / 20); // 0-5
      for (var i = 0; i < 5; i++) starsHtml += '<i class="' + (i < starCount ? 'on' : '') + '">★</i>';
      starBox.innerHTML = starsHtml;

      // 总结
      document.getElementById('ov-summary').textContent = f.summary;

      // 宜忌
      var doList = document.getElementById('do-list');
      var avoidList = document.getElementById('avoid-list');
      doList.innerHTML = f.dos.map(function (s) { return '<li>' + s + '</li>'; }).join('');
      avoidList.innerHTML = f.avo.map(function (s) { return '<li>' + s + '</li>'; }).join('');

      // 领域
      var grid = document.getElementById('domain-grid');
      grid.innerHTML = f.fields.map(function (fd) {
        var barColor = fd.level === 'good' ? 'var(--good)' : fd.level === 'bad' ? 'var(--bad)' : 'var(--gold)';
        return '<div class="domain-item">' +
          '<span class="d-icon">' + fd.icon + '</span>' +
          '<h4>' + fd.name + ' <span class="tag ' + fd.level + '">' + fd.tag + '</span></h4>' +
          '<div class="domain-scorebar"><span style="width:' + fd.score + '%;background:' + barColor + '"></span></div>' +
          '<p class="domain-desc">' + fd.desc + '</p>' +
          '</div>';
      }).join('');
    }
  }

  /* 页面加载完成后初始化 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
