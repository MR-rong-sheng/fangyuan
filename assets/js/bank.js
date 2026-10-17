/*
  方圆 · bank.js —— 题库加载器（父级文件，子任务直接 import 用）

  题库散在 content/bank/<拼音>-<年份>.json 里，index.json 是父级脚本生成的清单
  （前端拿不到目录列表，所以必须有清单）。这里负责：读清单、按需取卷、全量取题、
  纯函数筛选、把题库题转成练习/组卷/错题本共用的题目对象。
*/
const CACHE = new Map();

/** 13 个设区市（拼音与中文对应，筛选 UI 用） */
export const CITIES = [
  { pinyin: 'nj', city: '南京' }, { pinyin: 'wx', city: '无锡' }, { pinyin: 'xz', city: '徐州' },
  { pinyin: 'cz', city: '常州' }, { pinyin: 'sz', city: '苏州' }, { pinyin: 'nt', city: '南通' },
  { pinyin: 'lyg', city: '连云港' }, { pinyin: 'ha', city: '淮安' }, { pinyin: 'yc', city: '盐城' },
  { pinyin: 'yz', city: '扬州' }, { pinyin: 'zj', city: '镇江' }, { pinyin: 'tz', city: '泰州' },
  { pinyin: 'sq', city: '宿迁' },
];

export const KIND_NAMES = { '选择': '选择题', '填空': '填空题', '解答': '解答题' };
export const LEVEL_NAMES = { 1: '易', 2: '中', 3: '难' };

const U = 'assets/js/';

async function getJson(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

/** 题库清单。没有题库时返回空结构而不是抛错，页面才好显示「还没收题」。 */
export async function loadIndex() {
  if (CACHE.has('index')) return CACHE.get('index');
  let idx;
  try {
    idx = await getJson('content/bank/index.json');
  } catch (e) {
    idx = { generated: null, total: 0, cities: [], missing: true };
  }
  if (!Array.isArray(idx.cities)) idx.cities = [];
  CACHE.set('index', idx);
  return idx;
}

/** 单份试卷（按需加载 + 缓存），题目补上 city/year/pinyin。 */
export async function loadPaper(pinyin, year) {
  const key = `${pinyin}-${year}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const paper = await getJson(`content/bank/${key}.json`);
  const city = (CITIES.find(c => c.pinyin === pinyin) || {}).city || pinyin;
  paper.questions = (paper.questions || []).map(q => ({ ...q, pinyin, city, year: paper.year || year }));
  CACHE.set(key, paper);
  return paper;
}

/**
 * 全部题目（组卷用）。单份卷失败不致命——记下来继续，返回 { questions, papers, failed }。
 * onProgress(done, total) 可以喂进度条。
 */
export async function loadAll(onProgress) {
  const idx = await loadIndex();
  const jobs = [];
  for (const c of idx.cities) for (const y of c.years || []) jobs.push([c.pinyin, y.year, y.count || 0]);
  const out = [];
  const failed = [];
  let done = 0;
  const total = jobs.length;
  const CONC = 6;   // 并发别太高，本地服务也怕打开一堆连接
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const [py, yr] = jobs[cursor++];
      try {
        const p = await loadPaper(py, yr);
        out.push(...p.questions);
      } catch (e) {
        failed.push(`${py}-${yr}`);
      }
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, total || 1) }, worker));
  out.sort((a, b) => (a.city || '').localeCompare(b.city || '', 'zh') || (a.year || 0) - (b.year || 0) || (a.no || 0) - (b.no || 0));
  return { questions: out, papers: total - failed.length, failed };
}

/** 纯函数筛选：省略的参数视为不限；q 为关键词（题干/答案/解析/考点/城市）。 */
export function filterQuestions(list, opt = {}) {
  const kw = (opt.q || '').trim().toLowerCase();
  return (list || []).filter(x => {
    if (opt.city && x.city !== opt.city) return false;
    if (opt.year && Number(x.year) !== Number(opt.year)) return false;
    if (opt.kind && x.kind !== opt.kind) return false;
    if (opt.unit && x.unit !== opt.unit) return false;
    if (opt.level && Number(x.level) !== Number(opt.level)) return false;
    if (opt.ids && !opt.ids.includes(x.id)) return false;
    if (kw) {
      const hay = [x.stem, x.answer, x.solution, (x.tags || []).join(' '), x.city, x.year, (x.choices || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

/** 题库题 → 练习/组卷/错题本共用的题目对象。 */
export function toProblem(q) {
  return {
    id: q.id,
    stem: q.stem,
    choices: q.choices || null,
    answer: q.answer,
    why: q.solution || '',
    unit: q.unit || '',
    level: q.level || 2,
    tags: q.tags || [],
    kind: q.kind || '解答',
    source: q.src || '',
    city: q.city || '',
    year: q.year || '',
    no: q.no || '',
  };
}

/** 试卷标题，打印/导出用。 */
export function paperTitle(q) {
  return `${q.year}年${q.city}市中考数学 · 第${q.no}题`;
}
