const PINYIN_BOUNDARIES = "阿八嚓哒妸发旮哈击喀垃妈拿哦啪期然撒塌挖昔压匝";
const PINYIN_LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ";

// 获取任意字符的 A-Z 首字母（英文直接转大写，中文转拼音首字母，其他归为 #）
export function getFirstLetter(str: string): string {
  if (!str) return "#";
  const char = str.charAt(0);
  
  if (/[a-zA-Z]/.test(char)) {
    return char.toUpperCase();
  }
  
  if (/[\u4e00-\u9fa5]/.test(char)) {
    for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
      if (char.localeCompare(PINYIN_BOUNDARIES[i], 'zh-CN') >= 0) {
        return PINYIN_LETTERS[i];
      }
    }
  }
  
  return "#";
}

export function compareMixed(appNameA: string, appNameB: string): number {
  const letterA = getFirstLetter(appNameA);
  const letterB = getFirstLetter(appNameB);
  
  if (letterA === letterB) {
    // 如果首字母相同（比如 "Apple" 和 "阿狸" 都在 A 下），用原生方法再排内部顺序
    return appNameA.localeCompare(appNameB, 'zh-CN');
  }
  return letterA.localeCompare(letterB);
}
