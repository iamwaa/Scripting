import { Text, useState } from "scripting"
import { errorColor } from "../constants"

// 统一管理页面顶部 Toast 的状态与 List 属性
export function useToast() {
  const [toast, setToast] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false })

  const showToast = (msg: string, isError = false) => setToast({ msg, isError })

  const toastProps = {
    isPresented: toast.msg !== "",
    onChanged: (presented: boolean) => {
      if (!presented) {
        setToast({ msg: "", isError: false })
      }
    },
    content: <Text foregroundStyle={toast.isError ? errorColor : "label"}>{toast.msg}</Text>,
    position: "top" as const,
  }

  return { showToast, toastProps }
}
