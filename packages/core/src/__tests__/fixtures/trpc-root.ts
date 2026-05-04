// @ts-nocheck — fixture file, not compiled
export const appRouter = createTRPCRouter({
  user: userRouter,
  post: postRouter,
  auth: authRouter,
})

export type AppRouter = typeof appRouter
