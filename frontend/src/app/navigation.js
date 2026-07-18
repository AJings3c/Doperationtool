let navigateImpl = () => false;

export function setNavigator(navigator) {
    navigateImpl = typeof navigator === 'function' ? navigator : () => false;
}

export function navigate(toolId) {
    return navigateImpl(toolId);
}
