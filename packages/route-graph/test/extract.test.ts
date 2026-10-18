import { describe, expect, test } from "bun:test"
import { extractRoutes } from "../src/extract"

const parse = (source: string) => extractRoutes(source, "src/server/routes/test.ts")

describe("extractRoutes", () => {
  test("member-expression handler", async () => {
    const regs = await parse(`router.post('/channels/:id/messages', messageController.sendMessage);`)
    expect(regs).toHaveLength(1)
    const reg = regs[0]
    expect(reg.method).toBe("post")
    expect(reg.path).toBe("/channels/:id/messages")
    expect(reg.pathResolved).toBe(true)
    expect(reg.handlers).toHaveLength(1)
    expect(reg.handlers[0]).toMatchObject({ kind: "member", object: "messageController", name: "sendMessage" })
    expect(reg.line).toBe(1)
  })

  test("middleware chain captures every handler", async () => {
    const regs = await parse(
      `router.get('/posts/pending', isAdmin, async (req, res) => { res.send('ok'); });`,
    )
    expect(regs).toHaveLength(1)
    expect(regs[0].handlers.map((h) => h.kind)).toEqual(["identifier", "inline"])
    expect(regs[0].handlers[0]).toMatchObject({ kind: "identifier", name: "isAdmin" })
  })

  test("app.use with a router mounts it", async () => {
    const regs = await parse(`app.use('/api', authRouter);`)
    expect(regs).toHaveLength(1)
    expect(regs[0].method).toBe("use")
    expect(regs[0].path).toBe("/api")
    expect(regs[0].mounts).toBe("authRouter")
  })

  test("app.use without a path defaults to /", async () => {
    const regs = await parse(`app.use(cors());`)
    expect(regs).toHaveLength(1)
    expect(regs[0].path).toBe("/")
  })

  test("constant path resolves", async () => {
    const regs = await parse(`const P = '/health';\nrouter.get(P, check);`)
    expect(regs).toHaveLength(1)
    expect(regs[0].path).toBe("/health")
    expect(regs[0].pathResolved).toBe(true)
    expect(regs[0].pathRaw).toBe("P")
  })

  test("template literal path without substitution", async () => {
    const regs = await parse("router.get(`/status`, check);")
    expect(regs).toHaveLength(1)
    expect(regs[0].path).toBe("/status")
    expect(regs[0].pathResolved).toBe(true)
  })

  test("template literal with substitution is unresolved", async () => {
    const regs = await parse("router.get(`/users/${id}`, check);")
    expect(regs).toHaveLength(1)
    expect(regs[0].pathResolved).toBe(false)
  })

  test("router.route().get() chains", async () => {
    const regs = await parse(`router.route('/items/:id').get(getItem).put(updateItem);`)
    expect(regs).toHaveLength(2)
    expect(regs[0].path).toBe("/items/:id")
    expect(regs[0].method).toBe("get")
    expect(regs[1].method).toBe("put")
    expect(regs[1].handlers[0]).toMatchObject({ kind: "identifier", name: "updateItem" })
  })

  test("custom router variable from express.Router()", async () => {
    const regs = await parse(`const api = express.Router();\napi.delete('/old', remove);`)
    expect(regs).toHaveLength(1)
    expect(regs[0].onKnownRouter).toBe(true)
    expect(regs[0].handlers[0]).toMatchObject({ kind: "identifier", name: "remove" })
  })

  test("non-router receivers are ignored", async () => {
    const regs = await parse(`page.get('/x');\nclient.post('/y', handler);`)
    expect(regs).toHaveLength(0)
  })

  test("non-route methods on a router are ignored", async () => {
    const regs = await parse(`router.listen(3000);\nrouter.foo('/x', h);`)
    expect(regs).toHaveLength(0)
  })

  test("all HTTP verbs are captured", async () => {
    const regs = await parse(`
router.get('/a', h);
router.put('/b', h);
router.delete('/c', h);
router.patch('/d', h);
router.all('/e', h);
router.options('/f', h);
router.head('/g', h);
`)
    expect(regs.map((r) => r.method)).toEqual(["get", "put", "delete", "patch", "all", "options", "head"])
    expect(regs[2].line).toBe(4)
  })

  test("imported router counts as known", async () => {
    const regs = await parse(`import userRouter from './userRouter';\nuserRouter.get('/x', h);`)
    expect(regs).toHaveLength(1)
    expect(regs[0].onKnownRouter).toBe(true)
  })
})
