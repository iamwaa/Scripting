import { Text, VStack, Widget } from "scripting"


function getLunarDisplaySafe(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
    month: 'long',
    day: 'numeric'
  });

  const parts = formatter.formatToParts(date);
  let lunarMonth = "";
  let lunarDayStr = "";

  for (const part of parts) {
    if (part.type === 'month') lunarMonth = part.value;
    if (part.type === 'day') lunarDayStr = part.value;
  }

  const gYear = date.getFullYear();
  const gMonth = date.getMonth() + 1;
  let chineseYear = gYear;

  const isPreviousLunarYear = 
    gMonth <= 2 && 
    (lunarMonth.includes("十一") || lunarMonth.includes("十二") || 
     lunarMonth.includes("冬") || lunarMonth.includes("腊") || 
     lunarMonth === "11" || lunarMonth === "12");

  if (isPreviousLunarYear) {
    chineseYear -= 1;
  }

  const zodiacs = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
  let zIndex = (chineseYear - 4) % 12;
  if (zIndex < 0) zIndex += 12;
  const shengXiao = zodiacs[zIndex];

  const daysMap = [
    "", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
  ];
  
  const dayNum = parseInt(lunarDayStr, 10);
  if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 30) {
    lunarDayStr = daysMap[dayNum];
  }

  return `${shengXiao}年${lunarMonth}${lunarDayStr}`;
}

function getNextMidnight(): Date {
  const now = new Date();
  const midnight = new Date(now);
  // 设置为 24 小时，会自动进位到次日凌晨
  midnight.setHours(24, 0, 0, 0);
  return midnight;
}

function WidgetView() {
  return (
    <VStack
      padding
      frame={Widget.displaySize}
      background="accentColor"
      foregroundStyle="white"
    >
      <Text>{getLunarDisplaySafe(new Date())}</Text>
    </VStack>
  );
}

Widget.present(
  <WidgetView />,
  {
    // 设置为在指定日期（次日0点）之后才允许刷新
    reloadPolicy: {
      policy: "after",
      date: getNextMidnight()
    }
  }
);
