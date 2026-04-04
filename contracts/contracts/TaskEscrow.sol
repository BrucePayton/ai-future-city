// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * TaskEscrow - 任务资金托管合约
 *
 * 功能：
 * 1. 买家充值资金到托管
 * 2. 里程碑完成后释放资金给卖家
 * 3. 买家确认后完成最终结算
 * 4. 支持退款
 */
contract TaskEscrow is Ownable, ReentrancyGuard {

    // 订单状态
    enum EscrowStatus {
        Empty,           // 未初始化
        Funded,          // 已充值
        MilestoneClaimed, // 里程碑已申领
        Released,        // 已释放（部分或全部）
        Cancelled,       // 已取消/退款
        Completed        // 全部完成
    }

    // 里程碑
    struct Milestone {
        uint256 amount;      // 金额
        bool claimed;        // 是否已申领
        bool released;       // 是否已释放
        string description; // 描述
    }

    // 托管订单
    struct EscrowOrder {
        address buyer;       // 买家
        address seller;      // 卖家
        address token;       // 代币地址（address(0) = ETH）
        uint256 totalAmount; // 总金额
        uint256 releasedAmount; // 已释放金额
        EscrowStatus status;
        Milestone[] milestones;
        uint256 createdAt;
    }

    // 平台佣金比例（需要乘以 10000，即 1000 = 10%）
    uint256 public platformFeeRate = 1000; // 默认 10%

    // 订单映射
    mapping(bytes32 => EscrowOrder) public orders;

    // 平台收益记录
    mapping(address => uint256) public platformRevenue;

    // 事件
    event EscrowCreated(bytes32 indexed orderId, address buyer, address seller, uint256 amount);
    event Funded(bytes32 indexed orderId, uint256 amount);
    event MilestoneClaimed(bytes32 indexed orderId, uint256 milestoneIndex, uint256 amount);
    event MilestoneReleased(bytes32 indexed orderId, uint256 milestoneIndex, uint256 amount, uint256 platformFee);
    event OrderCompleted(bytes32 indexed orderId, uint256 totalReleased, uint256 platformFee);
    event Cancelled(bytes32 indexed orderId, uint256 refundAmount);
    event FeeRateUpdated(uint256 newFeeRate);

    constructor() Ownable(msg.sender) {}

    /**
     * 创建托管订单
     */
    function createEscrow(
        bytes32 orderId,
        address seller,
        address token,
        uint256[] memory milestoneAmounts,
        string[] memory milestoneDescriptions
    ) external nonReentrant {
        require(orders[orderId].status == EscrowStatus.Empty, "Order already exists");
        require(seller != address(0), "Invalid seller");
        require(milestoneAmounts.length > 0, "No milestones");

        EscrowOrder storage order = orders[orderId];
        order.buyer = msg.sender;
        order.seller = seller;
        order.token = token;
        order.status = EscrowStatus.Empty;
        order.createdAt = block.timestamp;

        uint256 total = 0;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            order.milestones.push(Milestone({
                amount: milestoneAmounts[i],
                claimed: false,
                released: false,
                description: milestoneDescriptions[i]
            }));
            total += milestoneAmounts[i];
        }
        order.totalAmount = total;

        emit EscrowCreated(orderId, msg.sender, seller, total);
    }

    /**
     * 充值到托管
     */
    function fund(bytes32 orderId) external payable nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.buyer == msg.sender, "Not buyer");
        require(order.status == EscrowStatus.Empty || order.status == EscrowStatus.Funded, "Invalid status");

        uint256 amount = msg.value;
        require(amount > 0, "No value");

        if (order.status == EscrowStatus.Empty) {
            require(amount >= order.totalAmount, "Insufficient funding");
            order.status = EscrowStatus.Funded;
        }

        emit Funded(orderId, amount);
    }

    /**
     * 使用 ERC20 充值
     */
    function fundWithToken(bytes32 orderId, uint256 amount) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.buyer == msg.sender, "Not buyer");
        require(order.status == EscrowStatus.Empty || order.status == EscrowStatus.Funded, "Invalid status");
        require(order.token != address(0), "Use fund() for ETH");

        IERC20 token = IERC20(order.token);
        require(token.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (order.status == EscrowStatus.Empty) {
            require(amount >= order.totalAmount, "Insufficient funding");
            order.status = EscrowStatus.Funded;
        }

        emit Funded(orderId, amount);
    }

    /**
     * 申领里程碑
     */
    function claimMilestone(bytes32 orderId, uint256 milestoneIndex) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.seller == msg.sender, "Not seller");
        require(order.status == EscrowStatus.Funded, "Not funded");
        require(milestoneIndex < order.milestones.length, "Invalid milestone");

        Milestone storage milestone = order.milestones[milestoneIndex];
        require(!milestone.claimed, "Already claimed");

        milestone.claimed = true;
        order.status = EscrowStatus.MilestoneClaimed;

        emit MilestoneClaimed(orderId, milestoneIndex, milestone.amount);
    }

    /**
     * 释放里程碑（平台操作）
     */
    function releaseMilestone(bytes32 orderId, uint256 milestoneIndex) external onlyOwner nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.status == EscrowStatus.MilestoneClaimed, "Not claimed");
        require(milestoneIndex < order.milestones.length, "Invalid milestone");

        Milestone storage milestone = order.milestones[milestoneIndex];
        require(milestone.claimed && !milestone.released, "Invalid milestone state");

        // 计算平台佣金
        uint256 fee = (milestone.amount * platformFeeRate) / 10000;
        uint256 sellerAmount = milestone.amount - fee;

        milestone.released = true;
        order.releasedAmount += milestone.amount;

        // 记录平台收入
        platformRevenue[order.token] += fee;

        // 释放给卖家
        if (order.token == address(0)) {
            payable(order.seller).transfer(sellerAmount);
        } else {
            IERC20(order.token).transfer(order.seller, sellerAmount);
        }

        // 检查是否全部完成
        bool allReleased = true;
        for (uint256 i = 0; i < order.milestones.length; i++) {
            if (!order.milestones[i].released) {
                allReleased = false;
                break;
            }
        }

        if (allReleased) {
            order.status = EscrowStatus.Completed;
            emit OrderCompleted(orderId, order.releasedAmount, fee);
        } else {
            order.status = EscrowStatus.Funded;
        }

        emit MilestoneReleased(orderId, milestoneIndex, sellerAmount, fee);
    }

    /**
     * 取消订单并退款
     */
    function cancelOrder(bytes32 orderId) external nonReentrant {
        EscrowOrder storage order = orders[orderId];
        require(order.buyer == msg.sender, "Not buyer");
        require(order.status == EscrowStatus.Funded, "Cannot cancel");

        uint256 refundAmount = order.totalAmount - order.releasedAmount;
        order.status = EscrowStatus.Cancelled;

        if (order.token == address(0)) {
            payable(order.buyer).transfer(refundAmount);
        } else {
            IERC20(order.token).transfer(order.buyer, refundAmount);
        }

        emit Cancelled(orderId, refundAmount);
    }

    /**
     * 设置平台佣金比例
     */
    function setFeeRate(uint256 newFeeRate) external onlyOwner {
        require(newFeeRate <= 5000, "Fee too high"); // 最多 50%
        platformFeeRate = newFeeRate;
        emit FeeRateUpdated(newFeeRate);
    }

    /**
     * 提取平台收入
     */
    function withdrawPlatformRevenue(address token) external onlyOwner nonReentrant {
        uint256 amount = platformRevenue[token];
        require(amount > 0, "No revenue");

        platformRevenue[token] = 0;

        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).transfer(owner(), amount);
        }
    }

    /**
     * 获取订单状态
     */
    function getOrderStatus(bytes32 orderId) external view returns (EscrowStatus, uint256, uint256) {
        EscrowOrder storage order = orders[orderId];
        return (order.status, order.totalAmount, order.releasedAmount);
    }

    /**
     * 获取里程碑数量
     */
    function getMilestoneCount(bytes32 orderId) external view returns (uint256) {
        return orders[orderId].milestones.length;
    }

    /**
     * 获取里程碑详情
     */
    function getMilestone(bytes32 orderId, uint256 index) external view returns (
        uint256 amount,
        bool claimed,
        bool released,
        string memory description
    ) {
        EscrowOrder storage order = orders[orderId];
        Milestone storage m = order.milestones[index];
        return (m.amount, m.claimed, m.released, m.description);
    }

    // 接收 ETH
    receive() external payable {}
}