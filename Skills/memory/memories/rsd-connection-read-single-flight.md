---
name: rsd-connection-read-single-flight
description: VPNRSDConnection.read 同一时刻只能有一个未决调用；用 Promise.race 加超时会留下悬空读，之后每次读都报 RSD_BUSY。
metadata:
  type: reference
---

**现象**：连上某个 RSD 服务后，第一轮读取正常拿到回包；一旦某次「等回包」等超时，**之后每一次
读都立刻报错**，而且错误文案和超时无关：

```
An RSD operation of this kind is already pending.
code=RSD_BUSY stage=validation nativeDomain=Scripting.JSRSDValues.Failure
```

看起来像服务把连接踢了，其实连接是好的——只是**上一次那个 `read()` 仍然挂在那里没被取走**。

**触发条件**：写「读一帧，最多等 N 毫秒」时用 `Promise.race([stream.read(n), sleep(N)])`。
超时分支只是让 `race` 先返回，**底层的 `read()` 仍然在等**，于是留下一个未决的读；下一次
`read()` 撞上它就被拒。

**规避写法**：整个连接只开**一条常驻读循环**，消费端从队列里取，超时只作用于「取队列」而不是
「发起读」：

```ts
class FrameReader {
  private readonly queue: Uint8Array[] = []
  private waiter: (() => void) | null = null
  constructor(private readonly stream: any) { void this.loop() }

  private async loop() {
    for (;;) {
      const chunk = await this.stream.read(16384) // 唯一的一条读，永不超时
      if (!chunk || chunk.length === 0) break
      // …按协议切帧，push 进 queue
      const w = this.waiter; this.waiter = null; w?.()
    }
  }

  /** 超时只等队列，不再发起新的 read。 */
  async next(timeoutMs: number): Promise<Uint8Array | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const frame = this.queue.shift()
      if (frame) return frame
      const left = deadline - Date.now()
      if (left <= 0) return null
      await new Promise<void>((resolve) => { this.waiter = resolve; setTimeout(resolve, left) })
    }
  }
}
```

顺带一个好处：常驻读循环自己能感知对端关闭（`read` 返回空 / 抛 `RSD_STREAM_CLOSED`），
可以在超时之前就告诉调用方连接断了，而不是干等。

**配套注意**：一旦连接被这种悬空读污染过就救不回来（后续读全部 `RSD_BUSY`），
只能关掉重连——所以探针里出现「第一轮好、之后全报 RSD_BUSY」时，先怀疑自己的读取写法，
不要往服务协议上找原因。

相关：[[afc-over-rsd-binary-protocol]]、[[atc-airtraffic-over-rsd]]
