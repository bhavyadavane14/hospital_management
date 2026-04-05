module.exports = function(roles = []) {
    return (req, res, next) => {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized. Please login.' });
        }
        
        if (roles.length > 0 && !roles.includes(req.session.role)) {
            return res.status(403).json({ error: 'Forbidden. Access restricted.' });
        }
        
        next();
    };
};
