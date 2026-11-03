window.__ModuleLoader__.load({
  id: '@local/dsh-local-install',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    /* ------------------------------------------------------------------ *
     * Constants
     * ------------------------------------------------------------------ */

    var PANEL_ID = 'dsh-local-install';
    var API = '/dsh-local-install/api';
    var LABEL = '本地安装';
    var HEADLINE = '本地安装插件';
    var SUBTITLE = '从本机的文件夹或 zip 压缩包安装 DSH 插件 —— 全程不走网络';

    // Author card. Also the fallback for a host that predates the /info
    // `author` field, so the credit never disappears from the page.
    var AUTHOR = {
      name: 'LiXiao1949',
      github: 'https://github.com/LiXiao1949',
      repo: 'https://github.com/LiXiao1949/dsh-local-installer',
      qq: '1640444672'
    };

    var COLORS = {
      accent: '#4d6bfe',
      onAccent: '#ffffff',
      danger: '#e5484d',
      ok: '#2f9e5e',
      warn: '#c07c1a',
      line: 'rgba(127,127,127,0.26)',
      fill: 'rgba(127,127,127,0.08)',
      fillStrong: 'rgba(127,127,127,0.15)'
    };

    var FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

    /* ------------------------------------------------------------------ *
     * Icons — inline SVG so the page never depends on host CSS or an icon
     * package whose export names change between releases.
     * ------------------------------------------------------------------ */

    function icon(size, strokeWidth, children) {
      var props = {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: strokeWidth || 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'block', flex: 'none' }
      };
      // Spread instead of a single array child: static icons never ask React
      // for keys, and there is no dynamic list here to key.
      return React.createElement.apply(null, ['svg', props].concat(children));
    }

    function path(d, extra) {
      return h('path', Object.assign({ d: d }, extra || {}));
    }

    function FolderIcon(props) {
      return icon(props.size || 16, 1.4, [
        path('M1.6 4.3c0-.6.5-1.1 1.1-1.1h3l1.3 1.4h6.3c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H2.7c-.6 0-1.1-.5-1.1-1.1z')
      ]);
    }

    function ZipIcon(props) {
      return icon(props.size || 16, 1.4, [
        path('M1.6 4.3c0-.6.5-1.1 1.1-1.1h3l1.3 1.4h6.3c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H2.7c-.6 0-1.1-.5-1.1-1.1z'),
        path('M8.4 3.2v8.6'),
        path('M6.4 5.2h2'),
        path('M6.4 7.1h2'),
        path('M6.4 9h2')
      ]);
    }

    function ChevronLeftIcon(props) {
      return icon(props.size || 14, 1.6, [path('M9.8 3.4 5.2 8l4.6 4.6')]);
    }

    function RefreshIcon(props) {
      return icon(props.size || 14, 1.5, [
        path('M13.2 8a5.2 5.2 0 1 1-1.6-3.7'),
        path('M13.4 2.9v3.2h-3.2')
      ]);
    }

    function CloseIcon(props) {
      return icon(props.size || 14, 1.6, [path('M4.4 4.4l7.2 7.2'), path('M11.6 4.4l-7.2 7.2')]);
    }

    function CheckIcon(props) {
      return icon(props.size || 14, 1.8, [path('M3.4 8.4l3 3 6.2-6.6')]);
    }

    function WarningIcon(props) {
      return icon(props.size || 14, 1.5, [
        path('M8 2.4 14.2 13H1.8z'),
        path('M8 6.4v3'),
        path('M8 11.2v.1')
      ]);
    }

    function Spinner(props) {
      var size = props.size || 14;
      return React.createElement.apply(null, [
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          focusable: 'false',
          style: {
            display: 'block',
            flex: 'none',
            animation: 'dsh-local-install-spin 0.9s linear infinite',
            color: 'inherit'
          }
        },
        h('circle', {
          cx: 8,
          cy: 8,
          r: 6,
          fill: 'none',
          stroke: 'currentColor',
          strokeOpacity: 0.25,
          strokeWidth: 2
        }),
        h('path', {
          d: 'M8 2a6 6 0 0 1 6 6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round'
        })
      ]);
    }

    /** Sidebar mark: a folder with a down arrow — "install into this profile". */
    function Logo(props) {
      var size = props && props.size ? props.size : 16;
      return icon(size, 1.3, [
        path('M1.6 4.3c0-.6.5-1.1 1.1-1.1h3l1.3 1.4h6.3c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H2.7c-.6 0-1.1-.5-1.1-1.1z'),
        path('M8 7.1v3.7'),
        path('M6.3 9.2 8 10.9l1.7-1.7')
      ]);
    }

    /* ------------------------------------------------------------------ *
     * Host transport
     * ------------------------------------------------------------------ */

    function apiFetch(pathname, init) {
      var options = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init || {});
      return fetch(API + pathname, options).then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (!response.ok) {
              var message = body && typeof body.error === 'string' ? body.error : 'HTTP ' + response.status;
              throw new Error(message);
            }
            return body;
          });
      });
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '';
      if (bytes < 1024) return bytes + ' B';
      var units = ['KB', 'MB', 'GB'];
      var value = bytes / 1024;
      var unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[unit];
    }

    function pluginLabel(plugin) {
      if (plugin === null || plugin === undefined) return '';
      var name = typeof plugin.name === 'string' ? plugin.name : '';
      var version = typeof plugin.version === 'string' ? plugin.version : '';
      if (name === '') return '';
      return version === '' ? name : name + '@' + version;
    }

    var STEP_TEXT = {
      resolving: '读取来源',
      staging: '复制 / 解压到本地插件目录',
      inspecting: '校验包信息',
      installing: '安装中',
      done: '完成',
      error: '失败',
      cancelled: '已取消'
    };

    /* ------------------------------------------------------------------ *
     * Presentational pieces
     * ------------------------------------------------------------------ */

    var styles = {
      page: {
        boxSizing: 'border-box',
        height: '100%',
        minHeight: '100%',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '18px 16px 48px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        fontSize: '14px',
        lineHeight: 1.5
      },
      headline: { margin: 0, fontSize: '19px', fontWeight: 600, letterSpacing: '-0.01em' },
      subtitle: { margin: '4px 0 0', fontSize: '12.5px', opacity: 0.62 },
      author: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 10px',
        padding: '9px 12px',
        border: '1px solid ' + COLORS.line,
        borderRadius: '10px',
        background: COLORS.fill,
        fontSize: '12px',
        lineHeight: 1.45
      },
      authorName: { fontWeight: 600, opacity: 0.92 },
      authorMeta: { opacity: 0.72 },
      authorLink: {
        color: COLORS.accent,
        textDecoration: 'none',
        borderBottom: '1px dashed ' + COLORS.accent,
        cursor: 'pointer'
      },
      card: {
        border: '1px solid ' + COLORS.line,
        borderRadius: '12px',
        background: COLORS.fill,
        padding: '12px 12px'
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 12px',
        border: '1px solid ' + COLORS.line,
        borderRadius: '10px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer'
      },
      button: {
        appearance: 'none',
        border: '1px solid ' + COLORS.line,
        background: COLORS.fillStrong,
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        padding: '6px 12px',
        borderRadius: '8px',
        cursor: 'pointer',
        flex: 'none'
      },
      primary: {
        appearance: 'none',
        border: '1px solid transparent',
        background: COLORS.accent,
        color: COLORS.onAccent,
        font: 'inherit',
        fontSize: '13px',
        fontWeight: 600,
        padding: '8px 16px',
        borderRadius: '8px',
        cursor: 'pointer',
        flex: 'none'
      },
      input: {
        flex: 1,
        minWidth: 0,
        boxSizing: 'border-box',
        padding: '8px 10px',
        border: '1px solid ' + COLORS.line,
        borderRadius: '8px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        fontFamily: FONT_MONO
      },
      badge: {
        fontSize: '11px',
        padding: '1px 7px',
        borderRadius: '999px',
        border: '1px solid ' + COLORS.line,
        background: COLORS.fillStrong,
        opacity: 0.9,
        flex: 'none',
        whiteSpace: 'nowrap'
      },
      hint: { fontSize: '12px', opacity: 0.6, margin: 0 },
      mono: { fontFamily: FONT_MONO, fontSize: '11.5px', wordBreak: 'break-all' },
      pre: {
        margin: 0,
        maxHeight: '240px',
        overflow: 'auto',
        padding: '10px',
        borderRadius: '8px',
        background: COLORS.fillStrong,
        fontFamily: FONT_MONO,
        fontSize: '11px',
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word'
      }
    };

    /**
     * Author credit line. Rendered on both surfaces (sidebar panel and
     * settings section) so the name, GitHub and QQ travel with the plugin.
     */
    function AuthorCard(props) {
      var source = props && props.author !== null && typeof props.author === 'object' ? props.author : AUTHOR;
      var pick = function (key) {
        var value = source[key];
        return typeof value === 'string' && value !== '' ? value : AUTHOR[key];
      };
      var name = pick('name');
      var github = pick('github');
      var repo = pick('repo');
      var qq = pick('qq');

      return h(
        'div',
        { style: styles.author, title: '插件作者信息' },
        h('span', { style: styles.authorName }, '作者 ' + name),
        h(
          'a',
          {
            href: github,
            target: '_blank',
            rel: 'noreferrer noopener',
            style: Object.assign({}, styles.authorLink, styles.authorMeta),
            title: github
          },
          'GitHub @' + name
        ),
        h(
          'a',
          {
            href: repo,
            target: '_blank',
            rel: 'noreferrer noopener',
            style: Object.assign({}, styles.authorLink, styles.authorMeta),
            title: repo
          },
          '项目仓库 dsh-local-installer'
        ),
        h('span', { style: styles.authorMeta, userSelect: 'all' }, 'QQ ' + qq)
      );
    }

    function Badge(props) {
      return h('span', { style: Object.assign({}, styles.badge, props.style || {}) }, props.children);
    }

    function SectionTitle(props) {
      return h(
        'div',
        {
          style: {
            fontSize: '12px',
            fontWeight: 600,
            opacity: 0.65,
            letterSpacing: '0.02em',
            margin: '2px 0 -4px'
          }
        },
        props.children
      );
    }

    function EntryRow(props) {
      var entry = props.entry;
      var disabled = props.busy === true;
      var isDir = entry.kind === 'dir';
      var openable = isDir;
      var onActivate = function () {
        if (disabled) return;
        if (isDir) props.onOpen(entry.path);
      };
      var subtitle = '';
      if (!isDir) {
        var size = formatBytes(entry.size || 0);
        subtitle = 'zip 压缩包' + (size === '' ? '' : ' · ' + size);
      }
      return h(
        'div',
        { style: Object.assign({}, styles.row, { cursor: openable ? 'pointer' : 'default' }), onClick: onActivate },
        isDir ? h(FolderIcon, { size: 18 }) : h(ZipIcon, { size: 18 }),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 } },
          h(
            'div',
            {
              style: {
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            },
            entry.name
          ),
          entry.plugin !== null && entry.plugin !== undefined
            ? h(
                'div',
                {
                  style: {
                    fontSize: '11.5px',
                    opacity: 0.62,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }
                },
                pluginLabel(entry.plugin) + (entry.plugin.installable === false ? ' · 不可安装' : '')
              )
            : subtitle !== ''
              ? h('div', { style: { fontSize: '11.5px', opacity: 0.62 } }, subtitle)
              : null
        ),
        entry.plugin !== null && entry.plugin !== undefined && entry.plugin.installable !== false
          ? h(Badge, { style: { color: COLORS.ok } }, '插件')
          : null,
        isDir
          ? h('span', { style: { opacity: 0.35, fontSize: '17px', lineHeight: 1 } }, '\u203a')
          : h(
              'button',
              {
                type: 'button',
                style: styles.primary,
                disabled: disabled,
                onClick: function (event) {
                  event.stopPropagation();
                  props.onInstall(entry.path);
                }
              },
              '安装'
            )
      );
    }

    function JobPanel(props) {
      var job = props.job;
      if (job === null || job === undefined) return null;
      var state = typeof job.state === 'string' ? job.state : 'running';
      var step = typeof job.step === 'string' ? job.step : '';
      var running = state === 'running';
      var lines = Array.isArray(job.log) ? job.log : [];
      var change = job.change && typeof job.change === 'object' ? job.change : null;
      var plugin = job.plugin && typeof job.plugin === 'object' ? job.plugin : null;

      var tone = state === 'error' ? COLORS.danger : state === 'done' ? COLORS.ok : 'inherit';

      var headline = running
        ? STEP_TEXT[step] || job.message || '安装中'
        : state === 'done'
          ? change && change.application === 'restart-required'
            ? '已安装，重启 DSH 后生效'
            : '已安装并启用'
          : state === 'cancelled'
            ? '已取消'
            : '安装失败';

      return h(
        'div',
        { style: Object.assign({}, styles.card, { display: 'flex', flexDirection: 'column', gap: '10px' }) },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          running ? h(Spinner, { size: 14 }) : null,
          state === 'done' ? h(CheckIcon, { size: 14 }) : null,
          state === 'error' ? h(WarningIcon, { size: 14 }) : null,
          h('div', { style: { fontWeight: 600, color: tone, flex: 1, minWidth: 0 } }, headline),
          running
            ? h(
                'button',
                {
                  type: 'button',
                  style: styles.button,
                  onClick: function () {
                    props.onCancel(job.id);
                  }
                },
                '取消'
              )
            : h(
                'button',
                {
                  type: 'button',
                  style: styles.button,
                  onClick: function () {
                    props.onDismiss();
                  }
                },
                '关闭'
              )
        ),
        plugin !== null && pluginLabel(plugin) !== ''
          ? h('div', { style: styles.mono }, '来源插件：' + pluginLabel(plugin))
          : null,
        job.stagedPath ? h('div', { style: styles.mono }, '安装源：' + job.stagedPath) : null,
        state === 'error' && job.error
          ? h(
              'div',
              {
                style: {
                  color: COLORS.danger,
                  fontSize: '12.5px',
                  wordBreak: 'break-word'
                }
              },
              String(job.error)
            )
          : null,
        change !== null && state === 'done'
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              change.bundle && change.bundle.name
                ? h(
                    'div',
                    { style: styles.mono },
                    change.bundle.name + (change.bundle.version ? '@' + change.bundle.version : '')
                  )
                : null,
              change.bundle && Array.isArray(change.bundle.rows) && change.bundle.rows.length > 0
                ? h(
                    'div',
                    { style: { fontSize: '11.5px', opacity: 0.65 } },
                    '注册行：' + change.bundle.rows.map(function (row) { return row.name || row.id; }).join('、')
                  )
                : null,
              Array.isArray(change.warnings) && change.warnings.length > 0
                ? h(
                    'div',
                    { style: { fontSize: '11.5px', color: COLORS.warn, wordBreak: 'break-word' } },
                    change.warnings.join('；')
                  )
                : null
            )
          : null,
        lines.length > 0
          ? h(
              'details',
              { style: { fontSize: '12px' } },
              h('summary', { style: { cursor: 'pointer', opacity: 0.7, padding: '2px 0' } }, '安装日志（' + lines.length + ' 行）'),
              h(
                'pre',
                {
                  style: Object.assign({}, styles.pre, { marginTop: '8px' }),
                  ref: function (node) {
                    if (node !== null) node.scrollTop = node.scrollHeight;
                  }
                },
                lines
                  .map(function (line) {
                    return line.text;
                  })
                  .join('\n')
              )
            )
          : null
      );
    }

    function InstalledSection(props) {
      var entries = Array.isArray(props.entries) ? props.entries : [];
      if (entries.length === 0) {
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          h(SectionTitle, null, '已安装到本机的插件'),
          h('p', { style: styles.hint }, '还没有从本机安装过插件。')
        );
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h(SectionTitle, null, '已安装到本机的插件'),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          entries.map(function (entry) {
            return h(
              'div',
              {
                key: entry.name,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  border: '1px solid ' + COLORS.line,
                  borderRadius: '8px',
                  fontSize: '12.5px'
                }
              },
              h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
              entry.version ? h('span', { style: { opacity: 0.6 } }, entry.version) : null,
              entry.enabled === true
                ? h(Badge, { style: { color: COLORS.ok } }, '已启用')
                : entry.enabled === false
                  ? h(Badge, null, '已停用')
                  : h(Badge, { style: { color: COLORS.warn } }, '未加载')
            );
          })
        ),
        h('p', { style: styles.hint }, '以上以 link 依赖形式记录在 profile 中，源文件在 profile 的 local-plugins 目录里。')
      );
    }

    /* ------------------------------------------------------------------ *
     * Page
     * ------------------------------------------------------------------ */

    function Page(props) {
      var surface = props && props.surface ? props.surface : 'panel';

      var infoState = React.useState(null);
      var info = infoState[0];
      var setInfo = infoState[1];

      var listingState = React.useState(null);
      var listing = listingState[0];
      var setListing = listingState[1];

      var pathState = React.useState('');
      var pathInput = pathState[0];
      var setPathInput = pathState[1];

      var errorState = React.useState(null);
      var error = errorState[0];
      var setError = errorState[1];

      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];

      var jobIdState = React.useState(null);
      var jobId = jobIdState[0];
      var setJobId = jobIdState[1];

      var jobState = React.useState(null);
      var job = jobState[0];
      var setJob = jobState[1];

      var installedState = React.useState([]);
      var installed = installedState[0];
      var setInstalled = installedState[1];

      var open = React.useCallback(function (dir) {
        setBusy(true);
        setError(null);
        return apiFetch('/list?path=' + encodeURIComponent(dir))
          .then(function (body) {
            setListing(body);
            setPathInput(typeof body.path === 'string' ? body.path : dir);
            setBusy(false);
          })
          .catch(function (failure) {
            setError(failure.message);
            setBusy(false);
          });
      }, []);

      var refreshInstalled = React.useCallback(function () {
        return apiFetch('/installed')
          .then(function (body) {
            setInstalled(Array.isArray(body.entries) ? body.entries : []);
          })
          .catch(function () {
            /* the installed list is informational only */
          });
      }, []);

      React.useEffect(function () {
        var alive = true;
        apiFetch('/info')
          .then(function (body) {
            if (!alive) return;
            setInfo(body);
            open(typeof body.initialDir === 'string' ? body.initialDir : '/');
          })
          .catch(function (failure) {
            if (alive) setError(failure.message);
          });
        refreshInstalled();
        return function () {
          alive = false;
        };
      }, [open, refreshInstalled]);

      // Poll one install job until it settles.
      React.useEffect(
        function () {
          if (jobId === null) return undefined;
          var stopped = false;
          var timer = null;
          var tick = function () {
            apiFetch('/job?id=' + encodeURIComponent(jobId))
              .then(function (next) {
                if (stopped) return;
                setJob(next);
                if (next.state === 'running') {
                  timer = setTimeout(tick, 420);
                } else {
                  refreshInstalled();
                }
              })
              .catch(function (failure) {
                if (stopped) return;
                setJob({ id: jobId, state: 'error', error: failure.message, log: [] });
              });
          };
          tick();
          return function () {
            stopped = true;
            if (timer !== null) clearTimeout(timer);
          };
        },
        [jobId, refreshInstalled]
      );

      var startInstall = React.useCallback(function (target) {
        setError(null);
        setJob({ state: 'running', step: 'resolving', message: '正在开始…', log: [] });
        return apiFetch('/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: target })
        })
          .then(function (body) {
            setJobId(body.id);
          })
          .catch(function (failure) {
            setJob(null);
            setError(failure.message);
          });
      }, []);

      var cancelInstall = React.useCallback(function (id) {
        if (typeof id !== 'string' || id === '') return undefined;
        return apiFetch('/cancel', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id })
        }).catch(function (failure) {
          setError(failure.message);
        });
      }, []);

      var navigate = function (dir) {
        if (typeof dir === 'string' && dir !== '') open(dir);
      };

      var current = listing !== null && listing.plugin !== null && listing.plugin !== undefined && listing.plugin.installable === true
        ? listing.plugin
        : null;

      var children = [];

      children.push(
        h(
          'div',
          { key: 'head', style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('h1', { style: styles.headline }, HEADLINE),
          h('p', { style: styles.subtitle }, SUBTITLE)
        )
      );

      children.push(
        h(AuthorCard, {
          key: 'author',
          author: info !== null && info.author !== undefined && info.author !== null ? info.author : AUTHOR
        })
      );

      children.push(
        h(
          'div',
          { key: 'path', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h(FolderIcon, { size: 16 }),
          h('input', {
            style: styles.input,
            value: pathInput,
            spellCheck: false,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            placeholder: '/绝对/路径',
            onChange: function (event) {
              setPathInput(event.target.value);
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') {
                event.preventDefault();
                navigate(pathInput);
              }
            }
          }),
          h(
            'button',
            {
              type: 'button',
              style: styles.button,
              title: '上一级',
              disabled: listing === null || !listing.parent || busy,
              onClick: function () {
                if (listing && listing.parent) navigate(listing.parent);
              }
            },
            h(ChevronLeftIcon, { size: 14 })
          ),
          h(
            'button',
            {
              type: 'button',
              style: styles.button,
              title: '刷新',
              disabled: busy,
              onClick: function () {
                navigate(listing !== null ? listing.path : pathInput);
              }
            },
            h(RefreshIcon, { size: 14 })
          )
        )
      );

      if (info !== null && Array.isArray(info.roots) && info.roots.length > 0) {
        children.push(
          h(
            'div',
            {
              key: 'roots',
              style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '-4px' }
            },
            info.roots.slice(0, 8).map(function (root) {
              return h(
                'button',
                {
                  key: root,
                  type: 'button',
                  style: Object.assign({}, styles.button, { fontSize: '11.5px', padding: '4px 9px' }),
                  onClick: function () {
                    navigate(root);
                  }
                },
                root
              );
            })
          )
        );
      }

      if (error !== null) {
        children.push(
          h(
            'div',
            {
              key: 'error',
              style: Object.assign({}, styles.card, {
                borderColor: COLORS.danger,
                color: COLORS.danger,
                fontSize: '12.5px',
                wordBreak: 'break-word'
              })
            },
            String(error)
          )
        );
      }

      if (current !== null) {
        children.push(
          h(
            'div',
            {
              key: 'current',
              style: Object.assign({}, styles.card, {
                borderColor: COLORS.accent,
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              })
            },
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '11.5px', opacity: 0.6 } }, '当前文件夹就是一个插件'),
              h('div', { style: { fontWeight: 600, wordBreak: 'break-all' } }, pluginLabel(current)),
              typeof current.description === 'string' && current.description !== ''
                ? h('div', { style: { fontSize: '12px', opacity: 0.62 } }, current.description)
                : null
            ),
            h(
              'button',
              {
                type: 'button',
                style: styles.primary,
                disabled: busy,
                onClick: function () {
                  startInstall(listing.path);
                }
              },
              '安装此文件夹'
            )
          )
        );
      }

      children.push(
        h(
          'div',
          { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          busy && listing === null ? h('p', { style: styles.hint }, '读取中…') : null,
          listing !== null
            ? listing.entries.length === 0
              ? h('p', { style: styles.hint }, '这个文件夹里没有子文件夹或 zip 文件。')
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                  listing.entries.map(function (entry) {
                    return h(EntryRow, {
                      key: entry.path,
                      entry: entry,
                      busy: busy,
                      onOpen: navigate,
                      onInstall: startInstall
                    });
                  })
                )
            : null
        )
      );

      if (job !== null) {
        children.push(
          h(JobPanel, {
            key: 'job',
            job: job,
            onCancel: cancelInstall,
            onDismiss: function () {
              setJob(null);
              setJobId(null);
            }
          })
        );
      }

      children.push(h(InstalledSection, { key: 'installed', entries: installed }));

      if (info !== null) {
        children.push(
          h(
            'p',
            { key: 'foot', style: Object.assign({}, styles.hint, { marginTop: '4px' }) },
            '安装位置：' + info.sourcesDir
          )
        );
      }

      return h(
        'div',
        {
          style: Object.assign({}, styles.page, surface === 'settings' ? { padding: '4px 2px 32px' } : null),
          'data-dsh-local-install': surface
        },
        children
      );
    }

    /* ------------------------------------------------------------------ *
     * Plugin registration — the same three seats the market uses, so the
     * page appears where the market appears: a sidebar panel, a settings
     * section, and the main panel that the sidebar row opens.
     * ------------------------------------------------------------------ */

    exports.name = 'dsh-local-install';
    exports.inject = ['slots'];

    exports.apply = function apply(ctx) {
      var style = document.createElement('style');
      style.setAttribute('data-dsh-local-install', '');
      style.textContent =
        '@keyframes dsh-local-install-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
      document.head.appendChild(style);

      var offStyle = function () {
        try {
          style.remove();
        } catch (error) {
          /* the page is going away; nothing to report */
        }
      };

      var panel = function () {
        return h(Page, { surface: 'panel' });
      };

      var section = function () {
        return h(Page, { surface: 'settings' });
      };

      // The sidebar row and its main panel.
      ctx.slots.inject('sidebar.panellist', function () {
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID
          },
          panel
        );
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 2,
            label: function () {
              return LABEL;
            }
          },
          function (owner) {
            return h(Logo, { size: owner && typeof owner.size === 'number' ? owner.size : 16 });
          }
        );
      });

      // The settings section, beside the market's own section.
      ctx.slots.inject('settings.section', function () {
        ctx.slots.register(
          {
            name: 'settings.section',
            id: PANEL_ID,
            order: 41,
            label: function () {
              return LABEL;
            }
          },
          section
        );
      });

      return offStyle;
    };

    return module.exports;
  }
});
