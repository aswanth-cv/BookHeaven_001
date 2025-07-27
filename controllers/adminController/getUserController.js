const User = require("../../models/userSchema");

const getUsers = async (req, res) => {
  try {
    const searchTerm = req.query.search || "";

    let searchQuery = {};
    if (searchTerm) {
      searchQuery = {
        $or: [
          { fullName: { $regex: searchTerm, $options: "i" } },
          { email: { $regex: searchTerm, $options: "i" } },
          { phone: { $regex: searchTerm, $options: "i" } },
        ],
      };
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 10; 
    const skip = (page - 1) * limit;

    const totalUsers = await User.countDocuments(searchQuery);

    const users = await User.find(searchQuery).skip(skip).limit(limit);

    const totalPages = Math.ceil(totalUsers / limit);
    const startIdx = skip;
    const endIdx = Math.min(skip + limit, totalUsers);

    res.render("getUser", {
      users: users || [],
      currentPage: page,
      totalPages,
      totalUsers,
      startIdx,
      endIdx,
      searchTerm,
    }); 
  } catch (error) {
    console.log("Error in getting User", error);
    res.status(500).send("Server error");
  }
};

const blockUser = async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findByIdAndUpdate(
      userId,
      { isBlocked: true },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User blocked successfully ",
      user: { id: user._id, isBlocked: user.isBlocked },
    });
  } catch (error) {
    console.log(`Error in deleting user,${error}`);
    return res.status(500).json({
      success: false,
      message: "server error",
    });
  }
};

const unblockUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findByIdAndUpdate(
      userId,
      { isBlocked: false},
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.log(`Error in unblocking user,${error}`);
    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

module.exports = { getUsers,blockUser,unblockUser };
