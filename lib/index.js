'use strict'

/**
 * Host half of @local/dsh-local-install.
 *
 * The plugin exists to mount the installer's HTTP routes; its browser half is
 * discovered from the `dsh.client` declaration in package.json and served at
 * /plugins/@local/dsh-local-install/client.js, so the host side is deliberately
 * thin.
 */

/** Stable cordis plugin name — must equal the package name so the
 * client-modules node half can resolvePkgJson('@local/dsh-local-install'). */
exports.name = '@local/dsh-local-install'

/** The installer registers routes as soon as a webserver exists. */
exports.inject = []

exports.apply = function apply(ctx) {
  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const { mountRoutes } = require('./routes.js')
      const dispose = mountRoutes(hostCtx)
      return () => {
        try {
          dispose()
        } catch (error) {
          hostCtx.logger?.warn?.('[dsh-local-install] 卸载路由失败：%s', error?.message ?? error)
        }
      }
    }, 'dsh-local-install: http routes')
  })
}
