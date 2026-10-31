/**
 * Host half of the traffic-light bundle.
 *
 * The control itself lives in the browser half (`client.js`), which reads the
 * session status hooks the sidebar and settings slots already provide. No Host
 * capability (files, sessions, tools) is needed, so this half registers
 * nothing; the Loader row exists only to make the `dsh.client` bundle part of
 * the profile's boot graph.
 */
export function apply() {}
