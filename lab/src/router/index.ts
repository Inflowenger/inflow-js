import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'overview', component: () => import('../pages/OverviewPage.vue') },
    {
      path: '/form-builder/preview',
      name: 'form-preview',
      component: () => import('../pages/FormPreviewPage.vue'),
    },
    {
      path: '/form-builder/debug-enum',
      name: 'debug-enum',
      component: () => import('../pages/DebugEnumPage.vue'),
    },
    {
      path: '/flow-trace/replay',
      name: 'flow-trace-replay',
      component: () => import('../pages/FlowTracePage.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
