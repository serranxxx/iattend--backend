const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

function isValidPhone(phone) {
    return typeof phone === 'string' && PHONE_REGEX.test(phone);
}

module.exports = {
    isValidPhone
}
