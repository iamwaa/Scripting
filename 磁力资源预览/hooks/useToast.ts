// 顶部 Toast 提示的通用逻辑

import { useObservable, useState } from "scripting";

export function useToast() {
  const [message, setMessage] = useState("");
  const isPresented = useObservable(false);

  // 重新置为 false 再延迟置 true，确保连续提示能再次弹出
  const notify = async (text: string, title = "提示") => {
    setMessage(title === "提示" ? text : `${title}：${text}`);
    isPresented.setValue(false);
    setTimeout(() => isPresented.setValue(true), 10);
  };

  const toastProps = {
    message,
    isPresented,
    position: "top" as const,
    duration: 2,
    cornerRadius: 16,
    shadowRadius: 8,
  };

  return { notify, toastProps };
}
