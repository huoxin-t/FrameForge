export function isTrustedSender(
  senderId: number,
  trustedWebContentsId: number | null,
): boolean {
  return trustedWebContentsId !== null && senderId === trustedWebContentsId;
}
